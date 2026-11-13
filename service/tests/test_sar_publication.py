import hashlib,json,tempfile,unittest
from pathlib import Path
import numpy as np
from service.sar.jobs import write_result, METHOD
from service.sar.native import NativeCrop,input_digest
from service.sar_publication import publish

class PublicationTests(unittest.TestCase):
 def test_review_identity_corruption_and_registry_race_preserve_last_publication(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);candidate=root/'candidate';public=root/'public';registry=public/'data/challenge/studies.json';registry.parent.mkdir(parents=True)
   original=b'{"schemaVersion":"1.0","studies":[]}\n';registry.write_bytes(original)
   request={'schemaVersion':'1.0','sourceId':'radarsat-1','operation':'native-observation','recordIds':['source-record'],'bbox':[0,0,.01,.01],'channel':'HH','pixelWindow':[0,0,2,2]}
   crop=NativeCrop(np.array([[1.,2.],[3.,4.]]),np.ones((2,2),bool),{'width':2,'height':2,'crs':'SOURCE_PIXEL_GRID (not geocoded)','transform':[0,1,0,0,0,1]},'native','native source magnitude (calibration withheld)','source units',{'sourceId':'radarsat-1','recordId':'source-record','channel':'HH','asset':'https://radarsat-r1-l1-cog.s3.ca-central-1.amazonaws.com/public.tif'})
   record={'id':'source-record','sourceId':'radarsat-1','title':'Source','product':'SLC','acquiredAt':'1996-03-04T13:02:25Z','endAt':None,'collection':'Radarsat-1-L1-COG','maturity':'source-defined','channels':['HH'],'bbox':[0,0,1,1],'scienceAssets':1,'referenceUrl':'https://registry.opendata.aws/radarsat-1/','notice':'native pixel magnitudes'}
   write_result(request,[record],crop,{'schemaVersion':'1.0','method':METHOD,'request':request,'inputs':[{'cropSha256':input_digest(crop),'grid':crop.grid,'convention':crop.convention,'evidence':crop.evidence}],'transferBytes':100},candidate)
   review={'decision':'approved','manifestSha256':hashlib.sha256((candidate/'manifest.json').read_bytes()).hexdigest(),'verification':'source-values-matched','reviewer':'independent-fixture','publicLocation':True}
   digest=hashlib.sha256(original).hexdigest()
   for change in [{'manifestSha256':'0'*64},{'verification':'not-checked'},{'publicLocation':False}]:
    with self.assertRaisesRegex(ValueError,'independent'):
     publish(candidate,public,'fixture','Fixture',{**review,**change},digest)
    self.assertEqual(registry.read_bytes(),original)
   entry=publish(candidate,public,'fixture','Fixture',review,digest)
   published=registry.read_bytes();manifest=(public/entry['manifestUrl'].lstrip('/')).read_bytes()
   self.assertEqual(hashlib.sha256(manifest).hexdigest(),entry['manifestSha256'])
   self.assertEqual(json.loads(manifest)['unit'],'source units')
   with self.assertRaisesRegex(ValueError,'registry changed'):
    publish(candidate,public,'fixture','Fixture',review,digest)
   self.assertEqual(registry.read_bytes(),published)
   (candidate/'values.json').write_text('{}')
   with self.assertRaisesRegex(ValueError,'checksum'):
    publish(candidate,public,'fixture','Fixture',review,hashlib.sha256(published).hexdigest())
   self.assertEqual(registry.read_bytes(),published)

class RcmIdentityTests(unittest.TestCase):
 def test_provider_missing_id_is_bound_only_by_exact_canonical_item_url(self):
  from service.sar.catalog import resolve
  from service.sar.net import SarError
  class Reader:
   def __init__(self,item):self.item=item
   def json(self,url):return self.item
  ident='0be3851c-1965-4e33-b37a-6206e3f14df9'
  item={'type':'Feature','collection':'rcm-ard','properties':{},'assets':{},'links':[{'rel':'self','href':'https://eodms-sgdot.nrcan-rncan.gc.ca/search/collections/rcm-ard/items/'+ident}]}
  record,_=resolve('rcm',ident,Reader(item));self.assertEqual(record['id'],ident)
  item['links'][0]['href']=item['links'][0]['href'].replace(ident,'another-id')
  with self.assertRaises(SarError):resolve('rcm',ident,Reader(item))

class RcmLicenseTests(unittest.TestCase):
 def test_imagery_grant_is_bound_to_exact_accepted_source_terms(self):
  from unittest.mock import patch
  from service.sar.rcm import verify_license
  from service.sar.net import SarError
  body=b'approved version';item={'assets':{'eula_license':{'href':'https://rcm-ceos-ard.s3.ca-central-1.amazonaws.com/RCM_EULA_PUBLIC_v1-0.pdf'}}}
  class Reader:
   def text(self,url,cap):return body
  with patch('service.sar.rcm.APPROVED_PUBLIC_LICENSE_SHA256',hashlib.sha256(body).hexdigest()):
   self.assertEqual(verify_license(item,Reader())['licenseSha256'],hashlib.sha256(body).hexdigest())
   body=b'changed terms'
   with self.assertRaises(SarError):verify_license(item,Reader())
