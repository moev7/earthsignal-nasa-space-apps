"""Independent exported-pixel check; optionally re-read the bounded native source crop.

Uses the production transport and metadata validator, but independently derives
windows, masks, ratio arithmetic, coverage, statistics and input digests. Does
not submit a job or publish a result. Run operator checks only with worker idle.
"""
import argparse
import hashlib
import json
from pathlib import Path


def verify(directory, *, remote=False, netrc=None):
    import numpy as np
    from osgeo import gdal, osr
    gdal.UseExceptions()
    directory = Path(directory)
    manifest = json.loads((directory / 'manifest.json').read_text())
    assert manifest['schemaVersion'] == '1.0'
    arrays = {}
    for name in ('before', 'after', 'difference', 'validity'):
        dataset = gdal.Open(str(directory / (name + '.tif')))
        assert list(dataset.GetGeoTransform()) == manifest['crop']['transform']
        assert [dataset.RasterXSize, dataset.RasterYSize] == [manifest['crop']['width'], manifest['crop']['height']]
        reference = osr.SpatialReference(); reference.SetFromUserInput(manifest['crop']['crs'])
        actual = osr.SpatialReference(); actual.ImportFromWkt(dataset.GetProjection())
        assert reference.IsSame(actual)
        arrays[name] = dataset.ReadAsArray(); dataset = None
    common = arrays['validity'] == 1
    assert set(np.unique(arrays['validity'])).issubset({0, 1})
    assert np.array_equal(common, np.isfinite(arrays['difference']))
    assert common.sum() == manifest['coverage']['commonValidPixels']
    for name in ('before', 'after'):
        good = np.isfinite(arrays[name])
        assert good.sum() == manifest['coverage'][name + 'ValidPixels']
        assert np.all(arrays[name][good] > 0)
    expected = 10 * np.log10(arrays['after'][common].astype('float64') / arrays['before'][common].astype('float64'))
    np.testing.assert_allclose(arrays['difference'][common], expected, atol=2e-6, rtol=1e-6)
    assert common.size == manifest['coverage']['totalPixels']
    assert abs(common.mean()*100 - manifest['coverage']['commonValidPercent']) < 1e-10
    pixel_area = abs(manifest['crop']['transform'][1] * manifest['crop']['transform'][5])
    assert abs(common.sum()*pixel_area/1e6 - manifest['coverage']['validAreaKm2']) < 1e-12
    for name, digest in manifest['processing']['sourceMetadata']['artifactSha256'].items():
        assert hashlib.sha256((directory/name).read_bytes()).hexdigest() == digest
    receipt = {'schemaVersion': '1.0', 'exportChecks': 'passed', 'validPixels': int(common.sum()),
        'medianDb': float(np.median(expected)), 'nativeSourceReproduction': 'not_requested',
        'independence': 'Independent windows, mask application, ratio arithmetic and digests; shared bounded transport and metadata validator'}
    if remote:
        from . import processing as transport
        from .range_reader import authenticated_opener, RemoteAsset, RangeProxy, TransferBudget
        sources = [transport.lookup_source(manifest[k]['id']) for k in ('before', 'after')]
        budget = TransferBudget(512*1024**2)
        opener = authenticated_opener(Path(netrc))
        assets = [RemoteAsset(s['url'], opener, budget) for s in sources]
        metadata = [transport.inspect_metadata(a, s) for a, s in zip(assets, sources)]
        transport.validate_metadata_pair(*metadata)
        powers, valid = [], []
        gt = manifest['crop']['transform']; width, height = manifest['crop']['width'], manifest['crop']['height']
        def srs(value):
            s = osr.SpatialReference(); s.SetFromUserInput(value); s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER); return s
        convert = osr.CoordinateTransformation(srs(manifest['crop']['crs']), srs('EPSG:4326'))
        yy, xx = np.indices((height, width))
        ll = np.asarray(convert.TransformPoints(np.column_stack((gt[0]+(xx.ravel()+.5)*gt[1],gt[3]+(yy.ravel()+.5)*gt[5])).tolist()))
        bbox = manifest['crop']['bbox']
        roi = ((ll[:,0]>=bbox[0]) & (ll[:,0]<=bbox[2]) & (ll[:,1]>=bbox[1]) & (ll[:,1]<=bbox[3])).reshape(height,width)
        with RangeProxy(assets) as proxy, transport._gdal_options():
            for i, meta in enumerate(metadata):
                pair = [transport._open_raster(proxy.vsi_path(i), name) for name in ('HHHH','mask','inputDataExceptionMask')]
                original = pair[0].GetGeoTransform()
                offsets = [(gt[0]-original[0])/original[1], (gt[3]-original[3])/original[5]]
                assert all(abs(v-round(v))<1e-7 for v in offsets)
                assert [original[k] for k in (1,2,4,5)] == [gt[k] for k in (1,2,4,5)]
                window = (round(offsets[0]),round(offsets[1]),width,height)
                power, mask, exception = [d.GetRasterBand(1).ReadAsArray(*window) for d in pair]
                assert meta == manifest['processing']['sourceMetadata'][('before','after')[i]]
                digest = hashlib.sha256()
                digest.update(json.dumps({'scope':'native crop power float64 + mask uint8 + optional exception mask uint16 + ancillary metadata + crop window','meta':meta,'window':window},sort_keys=True,allow_nan=False).encode())
                digest.update(np.asarray(power,dtype='<f8').tobytes()); digest.update(np.asarray(mask,dtype='u1').tobytes())
                digest.update(b'inputDataExceptionMask:uint16le\0'); digest.update(np.asarray(exception,dtype='<u2').tobytes())
                assert digest.hexdigest() == manifest['processing'][('beforeSha256','afterSha256')[i]]
                good = np.isfinite(power) & (power>0) & (mask>=1) & (mask<=254) & roi
                fill = meta['powerAttributes'].get('_FillValue')
                if fill is not None: good &= power != float(fill)
                if meta['productSpecificationVersion']=='1.5.0':
                    assert exception.dtype == np.uint8 and np.isin(exception,[0,2]).all(); good &= exception==0
                else:
                    assert meta['productSpecificationVersion']=='1.6.0' and exception.dtype==np.uint16
                    good &= (exception!=65535) & ((exception & 256)!=0) & ((exception & 255)==0)
                powers.append(power.astype('float64')); valid.append(good)
                np.testing.assert_array_equal(np.isfinite(arrays[('before','after')[i]]),good)
                np.testing.assert_array_equal(arrays[('before','after')[i]][good],power[good])
                pair.clear()
            proxy.check()
        native_common = valid[0] & valid[1]
        np.testing.assert_array_equal(native_common,common)
        native = 10*np.log10(powers[1][native_common]/powers[0][native_common])
        for key, value in zip(('medianDb','p05Db','p95Db','minDb','maxDb'),(np.median(native),*np.percentile(native,[5,95]),native.min(),native.max())):
            assert abs(float(value)-manifest['stats'][key])<1e-9
        receipt.update(nativeSourceReproduction='passed',transferBytes=budget.transferred,extractedInputDigests='matched',stats=manifest['stats'])
    return receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path); parser.add_argument('--remote-source',action='store_true')
    parser.add_argument('--netrc',type=Path,default=Path('/etc/earthsignal/earthdata.netrc'))
    args=parser.parse_args()
    print(json.dumps(verify(args.directory,remote=args.remote_source,netrc=args.netrc),indent=2))

if __name__=='__main__': main()
