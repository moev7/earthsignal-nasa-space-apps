"""Exact schema controls and offline pre-pixel crop gate tests."""
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

from service.observatory.dswx_schema import (
    REQUIRED_METADATA, VERSION, QUALITY_NOTE, UNSUPPORTED_MESSAGE, validate_header,
)
from service.observatory.raster import crop_bands, _validate_dswx_domain
from service.range_reader import RangeError

try:
    from osgeo import gdal, osr
except ImportError:
    gdal = osr = None


def header():
    return dict(metadata=dict(REQUIRED_METADATA), description='Water classification (WTR)',
                band_type_name='Byte', nodata=255.0,
                palette=[(255,255,255,255), (0,0,255,255), (180,213,244,255),
                         (0,0,0,255), (0,0,0,255)], expected_processing_version='1.1',
                crs_is_projected=True, linear_units=1.0,
                transform=(600000.0,30.0,0.0,4000020.0,0.0,-30.0))


class HeaderTests(unittest.TestCase):
    def test_detached_json_receipt_and_canonical_hash(self):
        h = header(); h['metadata']['private-extra'] = 'do-not-export'
        receipt = validate_header(**h)
        self.assertEqual(receipt['version'], VERSION)
        self.assertEqual(json.loads(json.dumps(receipt)), receipt)
        unhashed = {k:v for k,v in receipt.items() if k != 'receiptHash'}
        self.assertEqual(receipt['receiptHash'], hashlib.sha256(json.dumps(
            unhashed, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest())
        self.assertNotIn('do-not-export', json.dumps(receipt))
        h['metadata']['PRODUCT_VERSION'] = 'changed'
        h['palette'][2] = (1,2,3,4)
        self.assertEqual(receipt['checked']['metadata']['PRODUCT_VERSION'], '1.1')
        self.assertEqual(receipt['checked']['palette']['2'], [180,213,244,255])
        other = header(); other['metadata'] = dict(reversed(list(other['metadata'].items())))
        self.assertEqual(receipt['receiptHash'], validate_header(**other)['receiptHash'])

    def test_actual_captured_palette_with_explicit_synthetic_required_declarations(self):
        path = Path(__file__).resolve().parents[2] / 'outputs/class1-real-trial-20261013/header-palette.json'
        if not path.exists():
            self.skipTest('Captured read-only audit not present in this checkout')
        capture = json.loads(path.read_text())
        h = header()
        # The audit exported only version-related metadata, not source/type.
        # Those two declarations here are synthetic, not a claim of live proof.
        h['metadata'].update({k:v for k,v in capture['versions'].items() if k in REQUIRED_METADATA})
        h.update(description=capture['bandDescription'], band_type_name=capture['bandType'],
                 nodata=capture['nodata'], palette=capture['palette'], transform=capture['transform'])
        receipt = validate_header(**h)
        self.assertEqual(receipt['checked']['paletteCount'], 256)
        self.assertEqual(receipt['checked']['palette']['2'], [180,213,244,255])

    def test_all_required_metadata_exact_and_present(self):
        for key in REQUIRED_METADATA:
            for mutation in ('missing', 'wrong', 'space', 'type'):
                with self.subTest(key=key, mutation=mutation):
                    h=header()
                    if mutation=='missing':h['metadata'].pop(key)
                    else:h['metadata'][key]={'wrong':'unknown','space':REQUIRED_METADATA[key]+' ','type':True}[mutation]
                    with self.assertRaises(ValueError):validate_header(**h)

    def test_expected_version_is_exact(self):
        for value in (None, '1.0', '1.2', '1.1 ', 1.1, True, 'x'*100000):
            with self.subTest(value=str(value)[:20]):
                h=header();h['expected_processing_version']=value
                with self.assertRaises(ValueError):validate_header(**h)

    def test_band_and_grid_fail_closed(self):
        cases = [('description',v) for v in (None, '', 'Confidence classification (CONF)', 'Water classification (WTR) ', 'x'*100000)]
        cases += [('band_type_name',v) for v in (None,'UInt16','Float32',True)]
        cases += [('nodata',v) for v in (None,0,True,float('nan'),float('inf'),'255',10**1000)]
        cases += [('crs_is_projected',v) for v in (False,None,1,'True')]
        cases += [('linear_units',v) for v in (None,True,0.3048,1.000000001,float('nan'),float('inf'))]
        cases += [('transform',v) for v in (None,'30',[],(0,30,0,0,0,-30,0),
                   (0,20,0,0,0,-20),(0,30,1,0,0,-30),(0,30,0,0,1,-30),
                   (0,30,0,0,0,30),(0,30,0,0,0,-29.999),
                   (True,30,0,0,0,-30),(float('nan'),30,0,0,0,-30),
                   (0,30,0,float('inf'),0,-30),(10**1000,30,0,0,0,-30))]
        for key,value in cases:
            with self.subTest(key=key,value=str(value)[:40]):
                h=header();h[key]=value
                with self.assertRaises(ValueError):validate_header(**h)

    def test_uncollapsed_palette_and_shape_type_controls(self):
        for index,entry in [(0,(0,0,0,255)),(1,(0,0,255,0)),(2,(95,127,255,255)),
                            (3,(0,195,0,255)),(4,(150,255,150,255)),(2,(180,213,244,0)),
                            (2,(180,213,244)),(2,(True,213,244,255)),
                            (2,(180.0,213,244,255)),(2,(256,213,244,255)),
                            (2,(float('nan'),213,244,255))]:
            with self.subTest(index=index,entry=entry):
                h=header();h['palette'][index]=entry
                with self.assertRaises(ValueError):validate_header(**h)
        for palette in (None, {}, 'x'*100000, [], header()['palette'][:4], [(0,0,0,0)]*257):
            h=header();h['palette']=palette
            with self.assertRaises(ValueError):validate_header(**h)

    def test_palette_tuple_list_support_and_checked_header_hash_binding(self):
        h=header();h['palette']=tuple(list(v) for v in h['palette'])
        original=validate_header(**h)['receiptHash']
        self.assertEqual(original, validate_header(**header())['receiptHash'])
        h['transform']=list(h['transform']);h['transform'][0]+=30
        self.assertNotEqual(original,validate_header(**h)['receiptHash'])
        h=header();h['palette'][3]=(0,0,0,0)
        self.assertNotEqual(original,validate_header(**h)['receiptHash'])

    def test_metadata_collection_and_string_bounds(self):
        for extra in ({'x'*129:'v'}, {'x':'v'*4097}, {str(i):'v' for i in range(257)},
                      {str(i):'v'*4096 for i in range(17)}, {'x':object()}):
            h=header();h['metadata'].update(extra)
            with self.assertRaises(ValueError):validate_header(**h)
        for metadata in (None, [], 'x'*100000):
            h=header();h['metadata']=metadata
            with self.assertRaises(ValueError):validate_header(**h)


class DomainTests(unittest.TestCase):
    def test_collapsed_domain_and_selected_support(self):
        values=np.array([[0,1,2,252,253,254,255]],dtype=np.uint8)
        _validate_dswx_domain(values,np.ones(values.shape,dtype=bool))
        for unexpected in (3,4,5,251,256,-1,1.5,float('nan'),float('inf')):
            with self.subTest(unexpected=unexpected):
                values=np.array([[1,unexpected]],dtype=float)
                _validate_dswx_domain(values,np.array([[True,False]]))
                with self.assertRaises(RangeError) as error:
                    _validate_dswx_domain(values,np.array([[True,True]]))
                self.assertEqual(error.exception.code,'UNSUPPORTED_RASTER')

    def test_shape_and_mask_type_controls(self):
        for selected in (np.ones((1,1),bool),np.ones((1,2),np.uint8)):
            with self.assertRaises(RangeError):_validate_dswx_domain(np.ones((1,2)),selected)


class CropGateTests(unittest.TestCase):
    def setUp(self):
        self.h=header();self.values=np.array([[0,1],[2,255]],np.uint8)
        self.read=Mock(side_effect=lambda *args:self.values.copy())
        self.table=Mock();self.table.GetCount.return_value=5
        self.table.GetColorEntry.side_effect=lambda i:self.h['palette'][i]
        self.band=Mock(DataType=1);self.band.ReadAsArray=self.read
        self.band.GetColorTable.return_value=self.table
        self.band.GetDescription.side_effect=lambda:self.h['description']
        self.band.GetNoDataValue.side_effect=lambda:self.h['nodata']
        self.ref=Mock();self.ref.IsProjected.return_value=True
        self.ref.GetLinearUnits.return_value=1.0;self.ref.IsSame.return_value=True
        self.ref.ExportToWkt.return_value='synthetic projected metres'
        self.ds=Mock(RasterCount=1,RasterXSize=2,RasterYSize=2)
        self.ds.GetSpatialRef.return_value=self.ref
        self.ds.GetGeoTransform.side_effect=lambda:self.h['transform']
        self.ds.GetRasterBand.return_value=self.band
        self.ds.GetMetadata.side_effect=lambda:self.h['metadata']
        self.mask=Mock();self.mask.ReadAsArray.return_value=np.ones((2,2),np.uint8)
        self.gdal=Mock(OF_RASTER=1,GDT_Byte=1)
        self.gdal.OpenEx.return_value=self.ds
        self.gdal.GetDataTypeName.side_effect=lambda _:self.h['band_type_name']
        self.gdal.GetDriverByName.return_value.Create.return_value=self.mask
        self.ogr=Mock(wkbMultiPolygon=6)
        self.ogr.CreateGeometryFromJson.return_value.GetEnvelope.return_value=(600000,600060,3999960,4000020)
        self.osr=Mock(OAMS_TRADITIONAL_GIS_ORDER=0)
        self.proxy=Mock();self.proxy.__enter__=Mock(return_value=self.proxy)
        self.proxy.__exit__=Mock(return_value=False)
        self.assets={'water':{'href':'https://sentinel-cogs.s3.us-west-2.amazonaws.com/fixture.tif','expectedProcessingVersion':'1.1'}}
        self.area={'type':'Polygon','coordinates':[[[-115,36],[-114.999,36],[-114.999,36.001],[-115,36.001],[-115,36]]]}
        self.config=SimpleNamespace(netrc=Path('/unused'),transfer_bytes=1024*1024,max_pixels=1000000)

    def crop(self):
        with patch('service.observatory.raster._runtime',return_value=(self.gdal,self.ogr,self.osr)), \
             patch('service.observatory.raster.RangeProxy',return_value=self.proxy), \
             patch('service.observatory.raster.RemoteAsset'), patch('service.observatory.raster.opener'):
            return crop_bands(self.assets,self.area,self.config,kind='dswx')

    def assert_pre_pixel_rejection(self):
        with self.assertRaises(RangeError) as error:self.crop()
        self.assertEqual(error.exception.code,'UNSUPPORTED_RASTER')
        self.assertEqual(str(error.exception),UNSUPPORTED_MESSAGE)
        self.read.assert_not_called();self.mask.ReadAsArray.assert_not_called()

    def test_unknown_or_missing_headers_reject_before_any_array_read(self):
        cases=[('metadata',{}),('description','Confidence classification (CONF)'),
               ('band_type_name','UInt16'),('nodata',None),('transform',(0,20,0,0,0,-20)),
               ('palette',[(255,255,255,255),(0,0,255,255),(95,127,255,255),(0,195,0,255),(150,255,150,255)])]
        for key,value in cases:
            with self.subTest(key=key):
                self.h=header();self.h[key]=value;self.assert_pre_pixel_rejection()

    def test_missing_palette_count_and_single_band_controls(self):
        for count in (0,4,257):
            self.table.GetCount.return_value=count;self.assert_pre_pixel_rejection()
        self.table.GetCount.return_value=5
        self.band.GetColorTable.return_value=None;self.assert_pre_pixel_rejection()
        self.band.GetColorTable.return_value=self.table
        self.ds.RasterCount=2;self.assert_pre_pixel_rejection()

    def test_spatial_header_rejects_before_array_read(self):
        for projected,units in ((False,1),(True,.3048),(True,float('nan'))):
            self.ref.IsProjected.return_value=projected;self.ref.GetLinearUnits.return_value=units
            self.assert_pre_pixel_rejection()
        self.ds.GetSpatialRef.return_value=None;self.assert_pre_pixel_rejection()

    def test_unreadable_spatial_header_rejects_before_array_read(self):
        self.ds.GetGeoTransform.side_effect=RuntimeError('unreadable source header')
        self.assert_pre_pixel_rejection()

    def test_expected_key_presence_and_conflicting_asset_nodata(self):
        for version in (None,'1.0','1.2',1.1,True):
            self.assets['water']['expectedProcessingVersion']=version;self.assert_pre_pixel_rejection()
        self.assets['water']['expectedProcessingVersion']='1.1'
        for nodata in (0,True,float('nan')):
            self.assets['water']['nodata']=nodata;self.assert_pre_pixel_rejection()

    def test_admitted_crop_hash_note_class2_policy_and_domain_rejection(self):
        result=self.crop();self.read.assert_called_once_with(0,0,2,2)
        self.assertEqual(result['hashes']['waterSourceSchema'],validate_header(**self.h)['receiptHash'])
        self.assertIn(QUALITY_NOTE,result['qualityNotes'])
        self.assertEqual(result['totalPixels'],4);self.assertEqual(result['validPixels'],3)
        self.assertEqual(result['metrics'][0]['value'],.0009)
        self.assertEqual(result['metrics'][1]['value'],.0009)
        self.values[1,0]=3
        with self.assertRaises(RangeError) as error:self.crop()
        self.assertEqual(error.exception.code,'UNSUPPORTED_RASTER')

    def test_domain_ignores_outside_aoi_and_padding(self):
        self.values[1,0]=3;self.mask.ReadAsArray.return_value=np.array([[1,1],[0,1]],np.uint8)
        result=self.crop();self.assertEqual(result['totalPixels'],3);self.assertEqual(result['validPixels'],2)
        self.values[1,0]=2;self.ds.RasterXSize=1
        self.read.side_effect=lambda *args:self.values[:,:1].copy()
        self.mask.ReadAsArray.return_value=np.ones((2,2),np.uint8)
        result=self.crop();self.assertEqual(result['totalPixels'],4);self.assertEqual(result['validPixels'],2)

    def test_legacy_without_expected_key_preserves_synthetic_grid_and_type(self):
        self.assets['water'].pop('expectedProcessingVersion')
        self.h['metadata']={};self.h['band_type_name']='UInt16'
        self.h['transform']=(600000,20,0,4000020,0,-20)
        self.ogr.CreateGeometryFromJson.return_value.GetEnvelope.return_value=(600000,600040,3999980,4000020)
        self.h['palette']=None
        result=self.crop()
        self.assertNotIn('waterSourceSchema',result['hashes']);self.assertNotIn(QUALITY_NOTE,result['qualityNotes'])
        self.assertEqual(result['grid']['resolution'],20)
        self.assertEqual(result['metrics'][1]['value'],.0004)
        self.band.GetColorTable.assert_not_called()


@unittest.skipIf(gdal is None,'Native GDAL unavailable in existing environment')
class NativeHeaderTests(unittest.TestCase):
    def test_real_gdal_byte_palette_header(self):
        ds=gdal.GetDriverByName('MEM').Create('',2,2,1,gdal.GDT_Byte)
        h=header();ds.SetGeoTransform(h['transform']);ds.SetMetadata(h['metadata'])
        ref=osr.SpatialReference();ref.ImportFromEPSG(32611);ds.SetProjection(ref.ExportToWkt())
        band=ds.GetRasterBand(1);band.SetDescription(h['description']);band.SetNoDataValue(255)
        table=gdal.ColorTable()
        for i,rgba in enumerate(h['palette']):table.SetColorEntry(i,rgba)
        band.SetColorTable(table);table=band.GetColorTable();ref=ds.GetSpatialRef()
        receipt=validate_header(ds.GetMetadata(),band.GetDescription(),gdal.GetDataTypeName(band.DataType),
            band.GetNoDataValue(),[table.GetColorEntry(i) for i in range(table.GetCount())],
            '1.1',bool(ref.IsProjected()),ref.GetLinearUnits(),ds.GetGeoTransform())
        self.assertEqual(receipt['receiptHash'],validate_header(**h)['receiptHash'])


if __name__=='__main__':unittest.main()
