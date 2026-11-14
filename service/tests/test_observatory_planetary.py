"""Tests for planetary computer landsat adapter."""
import json
import unittest
from datetime import datetime, timezone, timedelta
from service.observatory.net import ProviderError, Transfer
from service.observatory import planetary as pc
import hashlib

def transfer(data, url):
    raw = data if isinstance(data, bytes) else json.dumps(data).encode()
    return Transfer(raw, url, hashlib.sha256(raw).hexdigest(), '2026-10-09T00:00:00+00:00')

class QueueBudget:
    def __init__(self, *values):
        self.values = list(values)
        self.urls = []
    def fetch(self, url, **kwargs):
        self.urls.append(url)
        if not self.values:
            raise ProviderError("exhausted")
        value = self.values.pop(0)
        if isinstance(value, Exception):
            raise value
        return transfer(value, url)

def request(start='2026-10-07', end='2026-10-08'):
    return dict(schemaVersion='1.0', domain='urban', question='change', area={'type':'Polygon','coordinates':[[[-122,47],[-121,47],[-121,48],[-122,48],[-122,47]]]}, start=start, end=end, options={})

class TestPlanetary(unittest.TestCase):
    def setUp(self):
        self.valid_stac = {
            "type": "FeatureCollection",
            "features": [{
                "id": "LC09_L2SP_046027_20261007_02_T1",
                "collection": "landsat-c2-l2",
                "properties": {
                    "datetime": "2026-10-07T18:00:00Z",
                    "landsat:collection_number": "02",
                    "platform": "landsat-9",
                    "landsat:correction":"L2SP", "landsat:wrs_path":"039", "landsat:wrs_row":"035",
                    "created": "2026-10-08T00:00:00Z"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-122,47],[-121,47],[-121,48],[-122,48],[-122,47]]]
                },
                "assets": {
                    "lwir11": {
                        "href": "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF",
                        "raster:bands": [{"unit":"kelvin", "scale": 0.00341802, "offset": 149, "nodata": 0}]
                    },
                    "qa_pixel": {
                        "href": "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test2.TIF",
                        "raster:bands": [{"nodata": 1}]
                    }
                }
            }]
        }

    def test_discover_success(self):
        budget = QueueBudget(self.valid_stac, self.valid_stac)
        out = pc.discover(request(), budget)
        self.assertEqual(len(out['candidates']), 1)
        self.assertFalse(out['evidence'][0]['public'])
        self.assertEqual(out['evidence'][0]['sourceId'], 'landsat-pc-lst')
        self.assertIn('assets', out['candidates'][0])
        self.assertIn('temperature', out['candidates'][0]['assets'])
        self.assertEqual(out['candidates'][0]['assets']['temperature']['scale'], 0.00341802)

    def test_calibration_mismatch(self):
        stac = json.loads(json.dumps(self.valid_stac))
        stac['features'][0]['assets']['lwir11']['raster:bands'][0]['scale'] = 0.0034
        budget = QueueBudget(stac, stac)
        with self.assertRaises(ProviderError) as ctx:
            pc.discover(request(), budget)
        self.assertEqual(str(ctx.exception), 'calibration_mismatch')

    def test_asset_has_query(self):
        stac = json.loads(json.dumps(self.valid_stac))
        stac['features'][0]['assets']['lwir11']['href'] = 'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF?token=123'
        budget = QueueBudget(stac, stac)
        with self.assertRaises(ProviderError) as ctx:
            pc.discover(request(), budget)
        self.assertEqual(str(ctx.exception), 'asset_has_query')

    def test_missing_assets(self):
        stac = json.loads(json.dumps(self.valid_stac))
        del stac['features'][0]['assets']['qa_pixel']
        budget = QueueBudget(stac, stac)
        out = pc.discover(request(), budget)
        self.assertEqual(len(out['candidates']), 0)
        self.assertEqual(len(out['missing']), 1)

    def test_sign_assets_success(self):
        candidate = {
            'assets': {
                'temperature': {'href': 'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF'},
                'qa': {'href': 'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test2.TIF'}
            }
        }
        sas_response1 = {"href": "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF?se=2030-01-01T00:00:00Z&sp=r&sig=abc", "msft:expiry": "2030-01-01T00:00:00Z"}
        sas_response2 = {"href": "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test2.TIF?se=2030-01-01T00:00:00Z&sp=r&sig=def"}
        budget = QueueBudget(sas_response1, sas_response2)
        new_assets = pc.sign_assets(candidate, budget)
        self.assertEqual(len(new_assets), 2)
        self.assertIn('sig=abc', new_assets['temperature']['href'])

    def test_injected_different_signed_url(self):
        candidate = {'assets': {'temperature': {'href': 'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF'}}}
        sas_response = {"href": "https://otherhost/asset1.tif?se=2030-01-01T00:00:00Z&sp=r&sig=abc"}
        budget = QueueBudget(sas_response)
        with self.assertRaises(ProviderError) as ctx:
            pc.sign_assets(candidate, budget)
        self.assertEqual(str(ctx.exception), 'unsafe_asset')

    def test_unsafe_writable_token(self):
        candidate = {'assets': {'temperature': {'href': 'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF'}}}
        sas_response = {"href": "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF?se=2030-01-01T00:00:00Z&sp=rw&sig=abc"}
        budget = QueueBudget(sas_response)
        with self.assertRaises(ProviderError) as ctx:
            pc.sign_assets(candidate, budget)
        self.assertEqual(str(ctx.exception), 'unsafe_sas_token')

    def test_expired_token(self):
        candidate = {'assets': {'temperature': {'href': 'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF'}}}
        sas_response = {"href": "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF?se=2000-01-01T00:00:00Z&sp=r&sig=abc", "msft:expiry": "2000-01-01T00:00:00Z"}
        budget = QueueBudget(sas_response)
        with self.assertRaises(ProviderError) as ctx:
            pc.sign_assets(candidate, budget)
        self.assertEqual(str(ctx.exception), 'expired_token')

    def test_candidate_contract_and_no_signed_provenance(self):
        out=pc.discover(request(),QueueBudget(self.valid_stac,self.valid_stac))
        c=out['candidates'][0]
        self.assertTrue({'kind','date','itemId','grid','version','platform','signer'} <= c.keys())
        self.assertNotIn('sig=',json.dumps(out))

    def test_public_ancillary_units_calibration_and_signing(self):
        stac=json.loads(json.dumps(self.valid_stac));assets=stac['features'][0]['assets']
        for key,unit in [('qa','kelvin'),('cdist','kilometer'),('qa_radsat','bit index')]:
            assets[key]={'href':f'https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/{key}.TIF','raster:bands':[{'unit':unit,**({'scale':.01,'nodata':-9999} if key!='qa_radsat' else {})}]}
        out=pc.discover(request(),QueueBudget(stac,stac));c=out['candidates'][0]
        self.assertEqual(set(c['assets']),{'temperature','qa','st_qa','cloud_distance','radsat'})
        self.assertEqual(c['assets']['st_qa']['offset'],0)
        signed=[{'href':a['href']+'?se=2030-01-01T00:00:00Z&sp=r&sig=fixture'} for a in c['assets'].values()]
        self.assertEqual(set(pc.sign_assets(c,QueueBudget(*signed))),set(c['assets']))
        assets['qa']['raster:bands'][0]['scale']=.1
        with self.assertRaisesRegex(ProviderError,'ancillary_calibration'):pc.discover(request(),QueueBudget(stac,stac))

    def test_absent_ancillary_checks_are_disclosed(self):
        out=pc.discover(request(),QueueBudget(self.valid_stac,self.valid_stac))
        self.assertEqual(sum('ancillary quality is absent' in n for n in out['evidence'][0]['quality']['notes']),3)

    def test_delete_permissions_and_bad_expiry_rejected(self):
        base='https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/standard/oli-tirs/test1.TIF'
        for q in ('se=2030-01-01T00:00:00Z&sp=rd&sig=x','se=bad&sp=r&sig=x','se=2030-01-01T00:00:00Z&sp=r&sp=rw&sig=x'):
            with self.assertRaises(ProviderError):pc.validate_signed_asset(base+'?'+q)

if __name__ == '__main__':
    unittest.main()
