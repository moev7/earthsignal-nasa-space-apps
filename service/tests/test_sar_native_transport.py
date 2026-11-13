"""Real TIFF decoder and bounded transport exercised with synthetic native arrays."""
import io
import unittest
from unittest.mock import patch
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from service.sar.native import read_tiff,read_cog,acquisition_time
from service.sar.net import SarError,PublicReader,vetted
from service.range_reader import RemoteAsset,TransferBudget,RangeError
from service.tests.test_processing import Response
from service.sar.rcm import descriptor

URL='https://radarsat-r1-l1-cog.s3.ca-central-1.amazonaws.com/test.tif'
class MemorySource:
    def __init__(self,raw):self.raw=raw
    def open(self,req,timeout=30):
        a,b=map(int,req.headers['Range'][6:].split('-'))
        return Response(self.raw[a:b+1],a,len(self.raw),url=URL)

def tiff(values,geographic=True):
    with MemoryFile() as mem:
        options=dict(driver='GTiff',width=values.shape[1],height=values.shape[0],count=1,dtype=values.dtype,nodata=0)
        if geographic:options.update(crs='EPSG:4326',transform=from_origin(0,3,1,1))
        with mem.open(**options) as ds:ds.write(values,1)
        return mem.read()

class NativeTransportTests(unittest.TestCase):
    def test_real_tiff_window_reads_original_cells_and_nodata_via_range_proxy(self):
        source=np.array([[1,2,3],[4,0,6],[7,8,9]],dtype='float32');budget=TransferBudget(1024*1024)
        remote=RemoteAsset(URL,MemorySource(tiff(source)),budget,validator=vetted)
        values,valid,grid=read_tiff(remote,[0,1,2,3])
        np.testing.assert_array_equal(values,source[:2,:2]);np.testing.assert_array_equal(valid,[[1,1],[1,0]])
        self.assertEqual(grid['transform'],[0,1,0,3,0,-1]);self.assertLessEqual(budget.transferred,1024*1024)
    def test_complex_native_pixels_are_magnitude_not_calibrated_or_geocoded(self):
        source=np.array([[3+4j,0],[5+12j,8+15j]],dtype='complex64');raw=tiff(source,False)
        class Reader:
            def asset(self,url):return RemoteAsset(url,MemorySource(raw),TransferBudget(1024*1024),validator=vetted)
        item={'id':'scene','collection':'Radarsat-1-L1-COG','properties':{'sar:polarizations':['HH']},'assets':{'cog':{'href':URL}}}
        crop=read_cog('radarsat-1',item,[0,0,.01,.01],'HH',Reader(),native=True,pixel_window=[0,0,2,2])
        np.testing.assert_array_equal(crop.values[crop.valid],[5,13,17]);self.assertEqual(crop.unit,'source units')
        self.assertEqual(crop.grid['crs'],'SOURCE_PIXEL_GRID (not geocoded)')
        with self.assertRaises(SarError):read_cog('radarsat-1',item,[0,0,.01,.01],'HH',Reader())
        with self.assertRaises(SarError):read_cog('radarsat-1',item,[0,0,.01,.01],'HH',Reader(),native=True,pixel_window=[1,1,2,2])
    def test_public_validator_errors_reach_range_proxy_check(self):
        self.assertTrue(issubclass(SarError,RangeError))
        remote=RemoteAsset(URL,MemorySource(tiff(np.ones((2,2),dtype='float32'))),TransferBudget(1024*1024),validator=lambda url,**kw: (_ for _ in ()).throw(SarError('unsafe_asset','Test rejection')) if kw else url)
        with self.assertRaises((SarError,rasterio.errors.RasterioIOError)):read_tiff(remote,[0,1,2,3])
        self.assertIsInstance(remote.error,SarError)
    def test_chronology_requires_explicit_time_zone_and_compares_instants(self):
        self.assertLess(acquisition_time('2026-01-01T01:00:00+02:00'),acquisition_time('2026-01-01T00:00:00Z'))
        for v in (None,'2026-01-01T00:00:00','nonsense'):
            with self.assertRaises(SarError):acquisition_time(v)
    def test_rcm_original_metadata_binds_channel_mask_calibration_and_processing(self):
        xml=b'''<product><CEOS-ARDProductAttributes><BackscatterMeasurementData><Polarization>RR</Polarization><BackscatterMeasurement>Gamma-0</BackscatterMeasurement><BackscatterConvention>linear power</BackscatterConvention><BackscatterConversionEq>10*log10(DN)</BackscatterConversionEq><DataType>Float</DataType><BitsPerSample>32</BitsPerSample><FileName>RR.tif</FileName></BackscatterMeasurementData><PerPixelMetadata><DataMask><FileName>mask.tif</FileName><BitValues><NoData>0</NoData><ValidData>1</ValidData><InvalidData>2</InvalidData><Shadow>7</Shadow></BitValues></DataMask></PerPixelMetadata></CEOS-ARDProductAttributes></product>'''
        class Reader:
            def text(self,url):return xml
        base='https://rcm-ceos-ard.s3.ca-central-1.amazonaws.com/test/'
        item={'collection':'rcm-ard','assets':{k:{'href':base+name} for k,name in [('rr','RR.tif'),('data_mask','mask.tif'),('metadata','meta.xml')]}}
        asset,conv,representation,metadata=descriptor(item,'RR',Reader())
        self.assertEqual((conv,representation),('gamma0','power'));self.assertEqual(metadata['validCode'],1)
        item['assets']['rr']['href']=base+'different.tif'
        with self.assertRaises(SarError):descriptor(item,'RR',Reader())

if __name__=='__main__':unittest.main()
