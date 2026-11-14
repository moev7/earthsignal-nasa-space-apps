#!/usr/bin/env python3
"""Independently reconcile a downloaded assessment's analytical GeoTIFFs.

No application modules, network requests, credentials or display PNGs are used.
Install native GDAL and NumPy; pass a directory containing manifest and rasters.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from osgeo import gdal, osr

def reproduce(directory):
    root=Path(directory).resolve()
    manifest=json.loads((root/'manifest.json').read_text())
    assert manifest['schemaVersion']=='1.0' and manifest['kind']=='assessment'
    gdal.UseExceptions();gdal.SetCacheMax(16*1024**2)
    results=[]
    for view in manifest.get('rasters',[]):
        layers={};grid=None
        recorded_crs=osr.SpatialReference();recorded_crs.ImportFromWkt(view['grid']['crs'])
        for name in ('before','after','difference','excluded'):
            filename=view['files'][name]['raster']
            assert Path(filename).name==filename
            path=root/filename
            assert not path.is_symlink() and path.is_file()
            with path.open('rb') as f:
                assert hashlib.file_digest(f,'sha256').hexdigest()==view['hashes'][filename]
            ds=gdal.OpenEx(str(path),gdal.OF_RASTER,allowed_drivers=['GTiff'])
            assert ds.RasterCount==1 and 0<ds.RasterXSize*ds.RasterYSize<=1_000_000
            current=(ds.RasterXSize,ds.RasterYSize,ds.GetGeoTransform(),ds.GetProjection())
            if grid is None:grid=current
            else:assert current==grid
            assert ds.GetSpatialRef().IsSame(recorded_crs)
            assert recorded_crs.IsProjected() and abs(recorded_crs.GetLinearUnits()-1)<1e-8
            assert current[2][2]==0 and current[2][4]==0
            assert current[:2]==(view['grid']['width'],view['grid']['height'])
            assert list(current[2])==view['grid']['transform']
            layers[name]=ds.ReadAsArray();ds=None
        mask=layers['excluded'];assert np.isin(mask,[0,1,2,3,255]).all()
        area=mask!=255;common=mask==0;total=int(area.sum());valid=int(common.sum())
        assert total==view['totalPixels'] and valid==view['validPixels'] and valid>0
        for name,expected in [('before',area&((mask&1)==0)),('after',area&((mask&2)==0)),('difference',common)]:
            assert np.array_equal(np.isfinite(layers[name]),expected)
        delta=layers['after'][common]-layers['before'][common]
        assert np.allclose(delta,layers['difference'][common],rtol=1e-12,atol=1e-12)
        coverage=100*valid/total;assert abs(coverage-view['commonCoveragePercent'])<1e-10
        value=float(delta.sum()*abs(grid[2][1]*grid[2][5])/1e6) if view['id']=='water' else float(np.median(delta))
        metric_id='water-area-change' if view['id']=='water' else view['id']+'-difference'
        measured=next(m for m in manifest['metrics'] if m['id']==metric_id)
        assert np.isclose(value,measured['value'],rtol=1e-12,atol=1e-12)
        results.append({'quantity':view['quantity'],'before':view['before']['date'],'after':view['after']['date'],
            'validPixels':valid,'totalPixels':total,'commonCoveragePercent':coverage,
            'metricId':metric_id,'reproducedValue':value,'unit':measured['unit'],'checks':'hashes, grids, validity, coverage, differences and reported metric'})
    return {'schemaVersion':'1.0','method':'independent-export-reconciliation-1','views':results,
        'limitation':'Checks exported calibrated measurements and masks; independent source-download and mask-definition validation remains separate.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory');args=parser.parse_args()
    print(json.dumps(reproduce(args.directory),indent=2))
