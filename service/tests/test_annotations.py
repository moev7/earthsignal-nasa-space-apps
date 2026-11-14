import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from service.annotations import Annotations, validate_request
from service.store import Problem
from service.tests import test_service as service_fixture
from service.tests.test_analysis import square


class AnnotationsTests(unittest.TestCase):
    setUp = service_fixture.Tests.setUp
    tearDown = service_fixture.Tests.tearDown
    headers = service_fixture.Tests.headers
    submit = service_fixture.Tests.submit

    def test_append_persistence_sequence_and_unverified_status(self):
        job = self.submit(); value = {'label':'water-change','note':'  suspected boundary  ','polygon':square()}
        first = self.api.annotations.append('user',job['id'],value)
        self.now += 1
        second = self.api.annotations.append('user',job['id'],{'label':'uncertain','note':'review later'})
        self.assertEqual(first['note'],'suspected boundary')
        self.assertEqual((first['version'],second['version']),(1,2)); self.assertNotEqual(first['id'],second['id'])
        self.assertLess(first['createdAt'],second['createdAt'])
        self.assertEqual(first['status'],'unverified-human-annotation')
        self.assertIsNone(second['polygon'])
        self.assertEqual(Annotations(self.store).list('user',job['id']),[first,second])

    def test_shared_job_annotations_are_private(self):
        job = self.submit(); self.store.claim(); self.store.complete(job['id'],{}); self.store.pin(job['id'])
        own = self.api.annotations.append('user',job['id'],{'label':'artifact','note':'mine'})
        other = self.api.annotations.append('other',job['id'],{'label':'uncertain','note':'theirs'})
        self.assertEqual(self.api.annotations.list('user',job['id']),[own])
        self.assertEqual(self.api.annotations.list('other',job['id']),[other])
        self.assertEqual(other['version'],1)

    def test_validation_and_limits(self):
        for value in ({},[],{'label':'flood','note':'x'},{'label':'uncertain','note':' '},
                      {'label':'artifact','note':'x'*1001},{'label':'artifact','note':False},
                      {'label':'artifact','note':'ok','status':'verified'},
                      {'label':[],'note':'ok'},{'label':'artifact','note':'ok','polygon':{'type':'Polygon','coordinates':[]}}):
            with self.subTest(value=value),self.assertRaises(Problem):
                validate_request(value)
        self.assertEqual(len(validate_request({'label':'artifact','note':'x'*1000})['note']),1000)
        self.assertEqual(validate_request({'label':'artifact','note':'\ufeffhello\ufeff'})['note'],'hello')
        self.assertEqual(validate_request({'label':'artifact','note':'😀'*500})['note'],'😀'*500)
        for note in ('😀'*501,'\ud800','\ufeff'):
            with self.assertRaises(Problem):
                validate_request({'label':'artifact','note':note})
        job = self.submit()
        for i in range(100):
            self.api.annotations.append('user',job['id'],{'label':'uncertain','note':str(i)})
        with self.assertRaises(Problem) as caught:
            self.api.annotations.append('user',job['id'],{'label':'artifact','note':'overflow'})
        self.assertEqual((caught.exception.status,caught.exception.code),(429,'annotation_limit'))
        self.assertEqual(len(self.api.annotations.list('user',job['id'])),100)

    def test_atomic_concurrent_sequence_and_cap(self):
        job = self.submit()
        for i in range(98):
            self.api.annotations.append('user',job['id'],{'label':'artifact','note':str(i)})
        def append(i):
            try:
                return self.api.annotations.append('user',job['id'],{'label':'artifact','note':f'concurrent{i}'})['version']
            except Problem as error:
                return error.code
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(append,range(4)))
        self.assertEqual(sorted(v for v in results if isinstance(v,int)),[99,100])
        self.assertEqual(results.count('annotation_limit'),2)
        self.assertEqual(len(self.api.annotations.list('user',job['id'])),100)

    def test_signed_routes_body_and_job_ownership(self):
        job = self.submit(); target = f"/api/change-jobs/{job['id']}/annotations"
        body = json.dumps({'label':'artifact','note':'owner only'}).encode()
        for method in ('GET','POST'):
            data = body if method == 'POST' else b''
            with self.assertRaises(Problem) as caught:
                self.api.dispatch(method,target,{},data)
            self.assertEqual(caught.exception.status,401)
            with self.assertRaises(Problem) as caught:
                self.api.dispatch(method,target,self.headers(method,target,user='other',body=data),data)
            self.assertEqual(caught.exception.status,404)
        status,annotation,_ = self.api.dispatch('POST',target,self.headers('POST',target,body=body),body)
        self.assertEqual(status,201)
        status,payload,_ = self.api.dispatch('GET',target,self.headers('GET',target),b'')
        self.assertEqual((status,payload),(200,{'annotations':[annotation]}))
        with self.assertRaises(Problem) as caught:
            self.api.dispatch('POST',target,self.headers('POST',target,body=body),body+b' ')
        self.assertEqual(caught.exception.status,401)
        for bad in (b'{',b'{"label":"artifact","note":"first","note":"duplicate"}'):
            with self.assertRaises(Problem) as caught:
                self.api.dispatch('POST',target,self.headers('POST',target,body=bad),bad)
            self.assertEqual(caught.exception.code,'invalid_json')
        self.assertEqual(len(self.api.annotations.list('user',job['id'])),1)
