import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from service.config import Config
from service.prepare_study import main
from service.store import Store, ARTIFACTS
from service.worker import Worker
from service.tests.test_worker import manifest

class PreparedTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.config=Config(Path(self.temp.name),b's'*32,reserve_bytes=0)
        self.store=Store(self.config)
        self.pairs=[({'fileID':'before'},{'fileID':'after'},'https://api.daac.asf.alaska.edu/unit-test'),
                    ({'fileID':'before2'},{'fileID':'after2'},'https://api.daac.asf.alaska.edu/unit-test')]
    def tearDown(self):self.temp.cleanup()
    def run_selection(self,codes):
        original=Store.submit;selected=[]
        def submit(store,owner,request,key,algorithm,selection=None):
            self.assertTrue(list((self.config.root/'selection').glob('*.json')))
            self.assertEqual(selection['request'],request)
            selected.append(selection)
            job=original(store,owner,request,key,algorithm,selection=selection)
            row=store.claim();code=codes[len(selected)-1]
            if code:
                store.fail(job['id'],code,'Test failure')
            else:
                stage=self.config.root/'staging'/row['id'];stage.mkdir()
                fixture=manifest();fixture['before']['id']=request['beforeId'];fixture['after']['id']=request['afterId']
                for name in ARTIFACTS:(stage/name).write_bytes(b'unit test artifact')
                (stage/'manifest.json').write_text(json.dumps(fixture))
                Worker(store).publish(row,stage)
            return job
        with patch('service.prepare_study.Config.environment',return_value=self.config),patch('service.prepare_study.capability',return_value={'ready':True}),patch('service.prepare_study.select_pairs',return_value=self.pairs),patch('service.prepare_study.time.sleep'),patch('service.prepare_study.Store.submit',new=submit),patch.object(sys,'argv',['prepare','--region','lake-mead','--bbox','1','2','3','4','--owner','owner']):
            outcome=main()
        return outcome,selected
    def test_rationale_precedes_processing_science_rejection_retained_and_success_pinned(self):
        outcome,selected=self.run_selection(['no_overlap',None])
        self.assertEqual(outcome,0);self.assertEqual(len(selected),2)
        jobs=self.store.list('owner');prepared=[j for j in jobs if j['prepared']]
        self.assertEqual(len(prepared),1)
        selection=prepared[0]['result']['processing']['sourceMetadata']['selectionRationale']
        self.assertEqual(selection['previousRejections'][0]['code'],'no_overlap')
        self.assertIn('Successful native crop',selection['verification'])
        artifact=json.loads((self.config.root/'results'/prepared[0]['id']/'manifest.json').read_text())
        self.assertEqual(artifact['processing']['sourceMetadata']['selectionRationale'],selection)
    def test_auth_network_budget_gates_stop_without_trying_next(self):
        for code in ('earthdata_auth','source_http','transfer_limit'):
            with self.subTest(code=code):
                # Separate owner/idempotency DB for each case.
                self.tearDown();self.setUp()
                outcome,selected=self.run_selection([code,None])
                self.assertEqual(outcome,3);self.assertEqual(len(selected),1)
                self.assertFalse(any(j['prepared'] for j in self.store.list('owner')))
    def test_missing_activation_does_not_discover_or_invent(self):
        with patch('service.prepare_study.Config.environment',return_value=self.config),patch('service.prepare_study.capability',return_value={'ready':False,'message':'Earthdata unavailable'}),patch('service.prepare_study.select_pairs') as select,patch.object(sys,'argv',['prepare','--region','tehran','--bbox','1','2','3','4','--owner','owner']):
            self.assertEqual(main(),2);select.assert_not_called()
        self.assertEqual(self.store.list('owner'),[])

if __name__=='__main__':unittest.main()
