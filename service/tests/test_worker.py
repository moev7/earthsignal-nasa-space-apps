import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from service.config import Config
from service.store import Store, ARTIFACTS
from service.worker import Worker

REQ={'beforeId':'before','afterId':'after','bbox':[1,2,3,4]}

def manifest():
    source=dict(track=1,frame=1,direction='Ascending',mode='test',release='test',collection='PROVISIONAL',url='https://nisar.asf.earthdatacloud.nasa.gov/test.h5')
    return dict(schemaVersion='1.0',kind='radar-change',title='Unit test fixture only',notice='Not an actual study',
      before={**source,'id':'before','acquiredAt':'2026-01-01T00:00:00Z'},after={**source,'id':'after','acquiredAt':'2026-01-02T00:00:00Z'},
      crop=dict(bbox=REQ['bbox'],crs='EPSG:32611',resolution=[30,30],width=1,height=1,transform=[0,30,0,0,0,-30],imageBounds=[[2,1],[4,3]]),
      stats=dict(medianDb=0,p05Db=0,p95Db=0,minDb=0,maxDb=0),
      coverage=dict(totalPixels=1,beforeValidPixels=1,afterValidPixels=1,commonValidPixels=1,commonValidPercent=100,validAreaKm2=.0009),
      layers=dict(before='before.png',after='after.png',difference='difference.png',excluded='excluded.png'),artifacts=sorted(ARTIFACTS),
      display=dict(backscatterMinDb=-1,backscatterMaxDb=1,differenceLimitDb=1),
      processing=dict(algorithmVersion='gcov-hhhh-v1',method='test fixture',processedAt='2026-01-03T00:00:00Z',beforeSha256='a'*64,afterSha256='b'*64,maskPolicy='test',sourceMetadata={}))

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.config=Config(Path(self.temp.name),b's'*32,reserve_bytes=0)
        self.store=Store(self.config)
    def tearDown(self):self.temp.cleanup()
    def submit(self,owner='owner',key='one'):return self.store.submit(owner,REQ,key,'gcov-hhhh-v1')
    def stage(self,row):
        path=self.config.root/'staging'/row['id'];path.mkdir()
        for name in ARTIFACTS:(path/name).write_bytes(b'unit test artifact')
        (path/'manifest.json').write_text(json.dumps(manifest()))
        return path
    def test_cache_separate_job_and_owned_directory(self):
        first=self.submit();row=self.store.claim()
        self.assertTrue(Worker(self.store).publish(row,self.stage(row)))
        second=self.submit('other');self.assertTrue(Worker(self.store).run_one())
        self.assertEqual(self.store.get('other',second['id'])['status'],'completed')
        self.assertNotEqual(first['id'],second['id'])
        self.assertEqual([j['id'] for j in self.store.list('other')],[second['id']])
        self.assertTrue((self.config.root/'results'/second['id']/'before.tif').exists())
    def test_cancel_racing_publication_removes_renamed_output(self):
        job=self.submit();row=self.store.claim();stage=self.stage(row)
        self.store.cancel('owner',job['id'])
        self.assertFalse(Worker(self.store).publish(row,stage))
        self.assertFalse((self.config.root/'results'/job['id']).exists())
    def test_extra_artifact_and_oversized_file_fail_before_rename(self):
        self.submit();row=self.store.claim();stage=self.stage(row)
        (stage/'secret.txt').write_text('test')
        with self.assertRaises(ValueError):Worker(self.store).publish(row,stage)
        (stage/'secret.txt').unlink()
        with (stage/'before.tif').open('wb') as stream:stream.truncate(self.config.artifact_bytes+1)
        with self.assertRaises(ValueError):Worker(self.store).publish(row,stage)
        self.assertFalse((self.config.root/'results'/row['id']).exists())
    def run_sleeping_child(self,worker,on_launch=None):
        real=subprocess.Popen;started=[]
        def start(*args,**kwargs):
            child=real([sys.executable,'-c','import time; time.sleep(30)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
            started.append(child)
            if on_launch:on_launch()
            return child
        with patch('service.worker.subprocess.Popen',side_effect=start):
            self.assertTrue(worker.run_one())
        self.assertEqual(len(started),1)
        self.assertIsNotNone(started[0].poll())
        return started[0]
    def test_cancellation_terminates_subprocess_group(self):
        job=self.submit();worker=Worker(self.store)
        self.run_sleeping_child(worker,lambda:self.store.cancel('owner',job['id']))
        self.assertEqual(self.store.get('owner',job['id'])['status'],'cancelled')
        self.assertFalse((self.config.root/'staging'/job['id']).exists())
    def test_wallclock_limit_and_shutdown_terminate_child(self):
        job=self.submit();worker=Worker(Store(replace(self.config,wall_seconds=0)))
        self.run_sleeping_child(worker)
        self.assertEqual(self.store.get('owner',job['id'])['error']['code'],'time_limit')
        job=self.submit(key='two');worker=Worker(self.store)
        self.run_sleeping_child(worker,worker.halt)
        self.assertEqual(self.store.get('owner',job['id'])['error']['code'],'interrupted')

if __name__=='__main__':unittest.main()
