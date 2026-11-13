"""Product dispatch and units at the shared job boundary; synthetic fixtures only."""
import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from service.config import Config
from service.sar import jobs
from service.sar.net import SarError

class ProductContractTests(unittest.TestCase):
 def request(self,**changes):
  return dict(dict(schemaVersion='1.0',sourceId='nisar',operation='pixel-offset',recordIds=['synthetic-GOFF'],bbox=[0,0,.01,.01],channel='HH',component='along-track',layer=2),**changes)
 def test_offset_settings_are_product_specific_and_bounded(self):
  jobs.validate_request(self.request())
  for changes in [dict(sourceId='rcm'),dict(layer=True),dict(layer=4),dict(component='vertical'),dict(operation='los-displacement')]:
   with self.assertRaises(SarError):jobs.validate_request(self.request(**changes))
 def test_preflight_cannot_substitute_products_or_admit_unverified_gslc_pairs(self):
  with tempfile.TemporaryDirectory() as t:
   netrc=Path(t)/'netrc';netrc.touch();config=Config(Path(t),b'x'*32,netrc=str(netrc))
   def resolve(source,ident,reader):return dict(id=ident,sourceId=source,acquiredAt='2026-01-01T00:00:00Z',collection='NISAR_L2_GCOV_V1'),dict(properties=dict(processingLevel='GCOV'))
   with patch('service.sar.jobs.resolve',side_effect=resolve):
    result=jobs.preflight(self.request(),config)
    self.assertFalse(result['ready']);self.assertEqual(result['unit'],'meters');self.assertTrue(any('product family' in g for g in result['gates']))
 def test_extended_products_reach_their_reader_and_verify_units(self):
  import numpy as np
  from types import SimpleNamespace
  from service.sar.native import NativeCrop
  for product,operation,unit,quantity,reader_name in [('GOFF','pixel-offset','meters','radar pixel offset','read_goff'),('GSLC','backscatter-observation','dB','radar backscatter','read_gslc')]:
   ident='synthetic-'+product
   request=dict(schemaVersion='1.0',sourceId='nisar',operation=operation,recordIds=[ident],bbox=[0,0,.01,.01],channel='HH')
   if product=='GOFF':request.update(component='along-track',layer=2)
   record=dict(id=ident,sourceId='nisar',acquiredAt='2026-01-01T00:00:00Z',collection='synthetic-fixture',maturity='not specified')
   item=dict(properties=dict(processingLevel=product))
   values=np.array([[0.,1.],[2.,np.nan]]);grid=dict(width=2,height=2,crs='EPSG:32639',transform=[0,20,0,40,0,-20])
   crop=NativeCrop(values,np.isfinite(values),grid,'synthetic fixture',quantity,unit,dict(sourceId='nisar',recordId=ident,channel='HH'))
   with tempfile.TemporaryDirectory() as t,patch('service.sar.jobs.resolve',return_value=(record,item)),patch('service.sar.nisar_extended.'+reader_name,return_value=crop) as native,patch('service.sar.native.read_nisar',side_effect=AssertionError('wrong reader')):
    root=Path(t);result=jobs.run(request,Config(root,b'x'*32),root,SimpleNamespace(budget=SimpleNamespace(transferred=1)))
    jobs.verify(root,request);self.assertEqual(result['unit'],unit);self.assertEqual(result['coverage']['valid'],3)
    if product=='GOFF':self.assertEqual(native.call_args.args[-2:],('along-track',2))
