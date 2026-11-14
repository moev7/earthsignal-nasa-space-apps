"""Synthetic accounting and admission checks; no environmental accuracy claim."""
import copy
import unittest
from unittest.mock import patch
import numpy as np
from service.observatory.water_transitions import classify_transitions, validate_report


def grid(width=3, height=2):
    return dict(crs='producer-asserted projected metre grid', resolution=30,
        transform=[0, 30, 0, 60, 0, -30], width=width, height=height,
        aggregation={'water':1}, aoiPolicy='Synthetic pixel centres')


def case():
    b = np.array([[0,1,1],[0,1,0]], dtype=float)
    a = np.array([[1,0,1],[0,1,0]], dtype=float)
    area = np.array([[True,True,True],[True,True,False]])
    bv = area.copy(); av = area.copy(); av[1,1] = False
    return b,a,bv,av,area,grid()


class TransitionAccountingTests(unittest.TestCase):
    def test_categories_unknown_outside_and_net_zero_turnover(self):
        inputs = case(); originals = [x.copy() for x in inputs[:5]]
        r,codes = classify_transitions(*inputs)
        self.assertEqual(codes.tolist(), [[1,2,3],[0,4,255]])
        self.assertEqual(r['counts'], dict(gain=1,loss=1,persistentClass1=1,nonClass1Both=1,unknown=1))
        self.assertEqual((r['totalPixels'],r['validPixels']), (5,4))
        self.assertEqual(r['netChangeKm2'], 0)
        self.assertAlmostEqual(r['turnoverKm2'], .0018)
        self.assertAlmostEqual(sum(r['areasKm2'].values()), .0045)
        for actual,old in zip(inputs,originals): np.testing.assert_array_equal(actual,old)
        self.assertEqual(classify_transitions(*inputs)[0], r)
        codes[0,0] = 255
        self.assertEqual(r['counts']['gain'], 1)

    def test_valid_masks_intersect_instead_of_union(self):
        b=np.array([[1.,0.],[1.,0.]]); a=np.array([[1.,1.],[0.,0.]])
        bv=np.array([[True,True],[False,False]]); av=np.array([[True,False],[True,False]])
        r,_=classify_transitions(b,a,bv,av,np.ones((2,2),bool),grid(2,2))
        self.assertEqual(r['counts'],dict(gain=0,loss=0,persistentClass1=1,nonClass1Both=0,unknown=3))
        self.assertEqual((r['validPixels'],r['totalPixels']), (1,4))

    def test_zero_is_nonclass1_and_invalid_values_stay_unknown(self):
        b,a,bv,av,area,g=case()
        b[1,2]=float('inf'); a[1,1]=float('nan')
        r,c=classify_transitions(b,a,bv,av,area,g)
        self.assertEqual((c[1,1],c[1,2]), (4,255))
        self.assertEqual(r['counts']['nonClass1Both'],1)
        b[0,0]=2  # Raw class 2 is not a binary indicator; upstream must convert explicitly.
        with self.assertRaises(ValueError): classify_transitions(b,a,bv,av,area,g)

    def test_bad_arrays_and_masks_are_rejected(self):
        for change in ('shape','complex','object','integer-mask','nonfinite','nonbinary','empty','no-common'):
            b,a,bv,av,area,g=case()
            if change=='shape':a=a[:1]
            elif change=='complex':a=a.astype(complex)
            elif change=='object':a=a.astype(object)
            elif change=='integer-mask':av=av.astype(np.uint8)
            elif change=='nonfinite':a[0,0]=np.nan
            elif change=='nonbinary':a[0,0]=.5
            elif change=='empty':area[:]=False
            elif change=='no-common':av[:]=False
            with self.subTest(change=change), self.assertRaises(ValueError):classify_transitions(b,a,bv,av,area,g)

    def test_bad_grid_and_oversize_are_rejected_before_hashing(self):
        for change in ('oversize','boolean-width','nan','huge','rotation','nonsquare','shape','extra'):
            b,a,bv,av,area,g=case()
            if change=='oversize':g['width']=1_000_001
            elif change=='boolean-width':g['width']=True
            elif change=='nan':g['resolution']=float('nan')
            elif change=='huge':g['resolution']=10**1000
            elif change=='rotation':g['transform'][2]=1
            elif change=='nonsquare':g['transform'][5]=-60
            elif change=='shape':g['height']=3
            elif change=='extra':g['madeUp']='field'
            with self.subTest(change=change), patch('service.observatory.water_transitions.array_hash',side_effect=AssertionError('Hash reached')), self.assertRaises(ValueError):
                classify_transitions(b,a,bv,av,area,g)

    def test_report_tampering_and_boolean_counts_fail(self):
        r,_=classify_transitions(*case())
        for change in ('count','boolean','area','net','turnover','gridhash','bad-hash','version','definition','extra'):
            bad=copy.deepcopy(r)
            if change=='count':bad['counts']['gain']+=1
            elif change=='boolean':bad['counts']['gain']=True
            elif change=='area':bad['areasKm2']['unknown']+=1
            elif change=='net':bad['netChangeKm2']=1
            elif change=='turnover':bad['turnoverKm2']=0
            elif change=='gridhash':bad['hashes']['grid']='0'*64
            elif change=='bad-hash':bad['hashes']['commonMask']='x'
            elif change=='version':bad['methodVersion']='confidence-v1'
            elif change=='definition':bad['classDefinition']='confirmed-water'
            elif change=='extra':bad['fieldAccuracy']=1
            with self.subTest(change=change), self.assertRaises(ValueError):validate_report(bad,case()[-1])
        original=copy.deepcopy(r);validate_report(r,case()[-1]);self.assertEqual(r,original)

    def test_support_hash_changes_with_mask_or_grid(self):
        inputs=list(case()); r,_=classify_transitions(*inputs)
        inputs[3][0,0]=False
        masked,_=classify_transitions(*inputs)
        self.assertNotEqual(masked['hashes']['commonMask'],r['hashes']['commonMask'])
        inputs[-1]['transform'][0]=30
        shifted,_=classify_transitions(*inputs)
        self.assertNotEqual(shifted['hashes']['grid'],masked['hashes']['grid'])


if __name__=='__main__':unittest.main()
