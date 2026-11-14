"""Authentic API-shaped fixtures and bounded network negative cases."""
import hashlib
import io
import json
import unittest
from itertools import permutations
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
from urllib.error import HTTPError
from service.observatory.net import Budget,Transfer,ProviderError,vetted_url,_VettedRedirects
from service.observatory import providers as p
from service.range_reader import TransferBudget


def transfer(data,url='https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items?f=json'):
    raw=data if isinstance(data,bytes) else json.dumps(data).encode()
    return Transfer(raw,url,hashlib.sha256(raw).hexdigest(),'2026-10-09T00:00:00+00:00')


class QueueBudget:
    def __init__(self,*values): self.values=list(values); self.urls=[]
    def fetch(self,url,**kwargs):
        self.urls.append(url)
        value=self.values.pop(0)
        if isinstance(value,Exception): raise value
        return transfer(value,url)


def request(domain='water',start='2025-06-01',end='2025-06-03'):
    return dict(schemaVersion='1.0',domain=domain,question='change',area=p.box_geometry([-114.8,36,-114.7,36.05]),
        start=start,end=end,options={'gaugeId':'09421500'})


def station():
    return {'type':'Feature','id':'USGS-09421500','properties':{'monitoring_location_name':'COLORADO RV BLW HOOVER DAM, AZ-NV'},
            'geometry':{'type':'Point','coordinates':[-114.73859363235,36.0152584726877]}}


def daily(day,value,**extra):
    props=dict(time_series_id='ad7aed75280e439c96815ccf2ac3f889',monitoring_location_id='USGS-09421500',parameter_code='00060',statistic_id='00003',
        time=day,value=value,unit_of_measure='ft^3/s',approval_status='Provisional',qualifier=None)
    props.update(extra)
    return dict(type='Feature',id='observation-'+day,properties=props,geometry=station()['geometry'])


def stac_item(kind='sentinel'):
    prefix='https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/sentinel-2-c1-l2a/11/S/PV/2025/6/S2C_T11SPV_20250628T182903_L2A/'
    assets={k:{'href':prefix+v,'raster:bands':[dict(nodata=0,scale=.0001,offset=-.1)]}
        for k,v in [('red','B04.tif'),('nir','B08.tif'),('swir16','B11.tif')]}
    assets['scl']={'href':prefix+'SCL.tif','raster:bands':[dict(nodata=0)]}
    return dict(type='Feature',id='S2C_T11SPV_20250628T182903_L2A',collection='sentinel-2-c1-l2a',geometry=p.box_geometry([-116,35,-114,37]),
        properties={'datetime':'2025-06-28T18:34:48.801000Z','created':'2025-06-29T01:04:58.493Z','s2:processing_baseline':'05.11','grid:code':'MGRS-11SPV','platform':'sentinel-2c'},assets=assets)


class ProviderTests(unittest.TestCase):
    def test_json_array_qualifiers_preserve_flags_and_do_not_lose_the_series(self):
        seen=[]
        rows=[daily('2025-06-01','100',approval_status='Approved',qualifier=['ESTIMATED']),
              daily('2025-06-03','200',qualifier=[])]
        out=p.usgs_daily(request(),QueueBudget(station(),dict(features=rows,links=[])),capture=seen.append)
        self.assertEqual(out['observations'],2)
        self.assertEqual(seen[0]['records'][0]['quality'],'Approved')
        self.assertEqual(seen[0]['records'][0]['qualifiers'],['ESTIMATED'])
        self.assertEqual(seen[0]['records'][1]['qualifiers'],[])
        self.assertEqual(out['series'][0]['points'][0]['quality'],'Approved · source qualifiers: ESTIMATED')
        self.assertEqual(out['series'][0]['points'][2]['quality'],'Provisional')
        self.assertIn('source estimates',out['evidence'][0]['quality']['notes'][-2])

    def test_mixed_json_qualifier_shapes_have_stable_bounded_union(self):
        rows=[daily('2025-06-01','100',qualifier=q) for q in (['ICE','ESTIMATED','ICE'],'ESTIMATED',None,[])]
        captured=[]
        for order in permutations(rows):
            seen=[]
            out=p.usgs_daily(request(),QueueBudget(station(),dict(features=list(order),links=[])),capture=seen.append)
            captured.append(seen[0]['records'])
            self.assertEqual(out['observations'],1)
            self.assertEqual(out['series'][0]['points'][0]['quality'],'Provisional · source qualifiers: ESTIMATED | ICE')
        self.assertTrue(all(rows==captured[0] for rows in captured))
        self.assertEqual(captured[0][0]['qualifiers'],['ESTIMATED','ICE'])

    def test_invalid_or_oversized_qualifiers_fail_without_capture(self):
        for bad in (1,False,{},[1],['ok',None],[[]],[''],['x'*65],['x\n'],['<tag>'],['a\\b'],['é'],['A']*17):
            with self.subTest(value=repr(bad)):
                seen=[]
                with self.assertRaises(ProviderError) as error:
                    p.usgs_daily(request(),QueueBudget(station(),dict(features=[daily('2025-06-01','100',qualifier=bad)],links=[])),capture=seen.append)
                self.assertEqual(str(error.exception),'unsupported_gauge_qualifier')
                self.assertEqual(seen,[])
        # Individually admitted rows must not expand the merged flag budget.
        rows=[daily('2025-06-01','100',qualifier=[str(i) for i in range(16)]),daily('2025-06-01','100',qualifier=['16'])]
        with self.assertRaises(ProviderError):
            p.usgs_daily(request(),QueueBudget(station(),dict(features=rows,links=[])))

    def test_qualified_estimate_is_recorded_without_approval_promotion(self):
        out=p.usgs_daily(request(),QueueBudget(station(),dict(features=[daily('2025-06-03','100',qualifier=['ESTIMATED'])],links=[])))
        self.assertEqual(out['metrics'][0]['label'],'Latest recorded daily mean discharge')
        self.assertIn('Source flags: ESTIMATED',out['metrics'][0]['description'])
        self.assertEqual(out['series'][0]['points'][2]['quality'],'Provisional · source qualifiers: ESTIMATED')
        self.assertIn('1 recorded days carry source qualifiers',out['findings'][0]['text'])
        self.assertIn('estimated readings',out['findings'][0]['text'])
        self.assertNotIn('point measurements',out['findings'][0]['text'])

    def test_vintage_hook_records_actual_days_and_preserves_qualifiers(self):
        seen=[]
        records=[daily('2025-06-01','100',qualifier='Estimated'),daily('2025-06-03','invalid')]
        out=p.usgs_daily(request(),QueueBudget(station(),dict(features=records,links=[])),capture=seen.append)
        self.assertEqual(len(seen),1)
        self.assertEqual([v['date'] for v in seen[0]['records']],['2025-06-01','2025-06-03'])
        self.assertEqual(seen[0]['records'][0]['qualifiers'],['Estimated'])
        self.assertIsNone(seen[0]['records'][1]['value'])
        self.assertNotIn('2025-06-02',[v['date'] for v in seen[0]['records']])
        self.assertEqual(out['observations'],1)
        self.assertNotIn('area',seen[0]);self.assertNotIn('owner',seen[0])

    def test_vintage_hook_receives_wholly_invalid_revision(self):
        seen=[]
        out=p.usgs_daily(request(),QueueBudget(station(),dict(features=[daily('2025-06-01',True)],links=[])),capture=seen.append)
        self.assertIsNone(seen[0]['records'][0]['value'])
        self.assertEqual(out['observations'],0)

    def test_vintage_hook_duplicate_qualifier_union_is_stable(self):
        records=[daily('2025-06-01','100',qualifier=q) for q in ('Estimated','Ice','Estimated')]
        snapshots=[]
        for order in permutations(records):
            seen=[]
            p.usgs_daily(request(),QueueBudget(station(),dict(features=list(order),links=[])),capture=seen.append)
            snapshots.append(seen[0]['records'])
        self.assertTrue(all(v==snapshots[0] for v in snapshots))
        self.assertEqual(snapshots[0][0]['qualifiers'],['Estimated','Ice'])

    def test_equal_value_duplicate_quality_is_permutation_invariant(self):
        records = [daily('2025-06-01','100',approval_status=q)
                   for q in ('Approved', 'Provisional', 'approval unknown')]
        results = [p.usgs_daily(request(), QueueBudget(station(), dict(features=list(order), links=[])))
                   for order in permutations(records)]
        points = [out['series'][0]['points'][0] for out in results]
        self.assertTrue(all(point == points[0] for point in points))
        self.assertEqual(points[0]['value'],100.)
        self.assertEqual(points[0]['quality'],'mixed duplicate approval status: approval unknown | Approved | Provisional')
        self.assertTrue(all('historical as-of' in out['evidence'][0]['quality']['notes'][-1] for out in results))

    def test_duplicate_conflict_is_sticky_under_all_permutations(self):
        # Repeating either value must not restore a conflict; an invalid
        # duplicate must not erase its reason. A different day stays usable.
        for values in [('100','200','100'), ('100','200','bad'), ('100','bad','100')]:
            for order in set(permutations(values)):
                records = [daily('2025-06-01', value) for value in order] + [daily('2025-06-03','300')]
                out = p.usgs_daily(request(), QueueBudget(station(), dict(features=records, links=[])))
                first = out['series'][0]['points'][0]
                self.assertIsNone(first['value'])
                self.assertEqual(first['quality'],'conflicting duplicate day; value withheld')
                self.assertEqual(out['observations'],1)

    def test_same_quality_duplicate_does_not_create_extra_observation(self):
        out = p.usgs_daily(request(), QueueBudget(station(), dict(features=[daily('2025-06-01','100')]*3, links=[])))
        self.assertEqual(out['observations'],1)
        self.assertEqual(out['series'][0]['points'][0]['quality'],'Provisional')

    def test_usgs_exact_station_series_gaps_and_units(self):
        r=request(); b=QueueBudget(station(),dict(features=[daily('2025-06-03','17600'),daily('2025-06-01','14300'),daily('2025-06-02','bad'),
            daily('2025-06-01','999',statistic_id='00001')],links=[]))
        out=p.usgs_daily(r,b)
        self.assertEqual(out['observations'],2)
        self.assertEqual([m['value'] for m in out['metrics']],[17600,3300])
        self.assertIsNone(out['series'][0]['points'][1]['value'])
        self.assertEqual(out['metrics'][1]['unit'],'ft^3/s')
        self.assertFalse(out['evidence'][0]['public'])
        self.assertIn('stationMetadata',out['evidence'][0]['hashes'])

    def test_usgs_selected_gauge_outside_polygon_is_not_local(self):
        s=station();s['geometry']['coordinates']=[-115,36]
        out=p.usgs_daily(request(),QueueBudget(s))
        self.assertFalse(out['metrics']);self.assertEqual(out['observations'],0)
        self.assertIn('exact area',out['missing'][0])

    def test_point_filter_holes_and_antimeridian(self):
        area=p.box_geometry([0,0,3,3]);area['coordinates'].append([[1,1],[2,1],[2,2],[1,2],[1,1]])
        self.assertTrue(p.contains(area,.5,.5));self.assertFalse(p.contains(area,1.5,1.5));self.assertFalse(p.contains(area,1,1.5))
        area={'type':'Polygon','coordinates':[[[179,0],[-179,0],[-179,2],[179,2],[179,0]]]}
        self.assertTrue(p.contains(area,179.5,1));self.assertTrue(p.contains(area,-179.5,1));self.assertFalse(p.contains(area,0,1))
        self.assertEqual(len(p.search_boxes(area)),2)

    def test_firms_exact_filter_not_burned_area_and_zero_not_absence(self):
        today=datetime.now(timezone.utc).date().isoformat();r=request('fire',today,today)
        raw=('latitude,longitude,acq_date,acq_time,satellite,confidence,version\n'
             f'36.01,-114.75,{today},1230,N,high,2.0NRT\n'
             f'36.01,-114.75,{today},1230,N,low,2.0NRT\n'
             f'36.01,-115.0,{today},1230,N,high,2.0NRT\n').encode()
        out=p.firms(r,QueueBudget(raw));self.assertEqual(out['metrics'][0]['value'],1)
        self.assertEqual(out['metrics'][0]['unit'],'detections');self.assertNotIn('area',out['metrics'][0]['id'])
        out=p.firms(r,QueueBudget(raw.splitlines()[0]+b'\n'))
        self.assertFalse(out['metrics']);self.assertIn('not evidence of no fire',out['missing'][0])

    def test_firms_historical_period_does_not_use_current_feed(self):
        b=QueueBudget();out=p.firms(request('fire'),b)
        self.assertEqual(b.urls,[]);self.assertEqual(out['observations'],0)

    def test_sentinel_real_c1_metadata_calibration_not_fake_hls(self):
        r=request('ecology','2025-06-01','2025-06-30');item=stac_item();d={'features':[item]}
        out=p.stac_discovery(r,QueueBudget(d,d),'sentinel')
        self.assertEqual(out['observations'],0);self.assertFalse(out['metrics'])
        self.assertEqual(out['evidence'][0]['sourceId'],'sentinel-2-indices')
        self.assertEqual(out['candidates'][0]['assets']['red']['offset'],-.1)
        self.assertEqual(out['candidates'][0]['assets']['qa']['nodata'],0)
        self.assertTrue(out['evidence'][0]['timestamps']['observedStart'].startswith('2025-06-28'))

    def test_sentinel_unsafe_asset_and_conflicting_offsets_discovery_only(self):
        r=request('ecology','2025-06-01','2025-06-30');item=stac_item();item['assets']['red']['href']='https://127.0.0.1/private.tif'
        out=p.stac_discovery(r,QueueBudget({'features':[item]},{'features':[item]}),'sentinel')
        self.assertFalse(out['candidates']);self.assertTrue(out['missing']);self.assertTrue(out['evidence'])
        item=stac_item();item['assets']['red']['raster:bands'][0]['offset']=0
        out=p.stac_discovery(r,QueueBudget({'features':[item]},{'features':[item]}),'sentinel')
        self.assertFalse(out['candidates']);self.assertIn('contradictory_reflectance_offset',out['missing'][0])

    def test_cmr_real_id_and_protected_cog_has_no_measurement_until_read(self):
        record=dict(id='G3558717017-POCLOUD',producer_granule_id='OPERA_L3_DSWx-HLS_T11SPV_20250601T181502Z_20250605T123927Z_L8_30_v1.0',
            time_start='2025-06-01T18:15:02.801Z',time_end='2025-06-01T18:15:02.801Z',updated='2025-06-05T12:43:17.275Z',
            boxes=['35.177986 -115.9553702 36.1842228 -114.7219216'])
        record['links']=[dict(href='https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-protected/OPERA_L3_DSWX-HLS_V1/'+record['producer_granule_id']+'_B01_WTR.tif')]
        out=p.cmr_discovery(request(),QueueBudget({'feed':{'entry':[record]}}))
        self.assertIn('G3558717017',out['evidence'][0]['title']);self.assertFalse(out['metrics']);self.assertEqual(len(out['candidates']),1);self.assertEqual(out['candidates'][0]['grid'],'11SPV')

    def test_unsafe_cmr_asset_is_missing_not_provider_crash(self):
        record=dict(id='G3558717017-POCLOUD',producer_granule_id='OPERA_L3_DSWx-HLS_T11SPV_20250601T181502Z_20250605T123927Z_L8_30_v1.0',time_start='2025-06-01T18:15:02Z',links=[dict(href='https://127.0.0.1/private_B01_WTR.tif')])
        out=p.cmr_discovery(request(),QueueBudget({'feed':{'entry':[record]}}))
        self.assertFalse(out['candidates']); self.assertTrue(out['evidence']); self.assertIn('unvetted',out['missing'][0])

    def test_cmr_source_filename_must_match_producer_and_observation(self):
        product='OPERA_L3_DSWx-HLS_T11SPV_20250601T181502Z_20250605T123927Z_L8_30_v1.0'
        wrong=product.replace('20250601','20240601')
        record=dict(id='G-fixture',producer_granule_id=product,time_start='2025-06-01T18:15:02Z',
                    links=[dict(href='https://archive.podaac.earthdata.nasa.gov/'+wrong+'_B01_WTR.tif')])
        out=p.cmr_discovery(request(),QueueBudget({'feed':{'entry':[record]}}))
        self.assertTrue(out['evidence']);self.assertFalse(out['candidates'])
        self.assertTrue(any('does not match' in note for note in out['missing']))

    def test_cmr_preserves_unsupported_processing_release_without_reading_pixels(self):
        base='OPERA_L3_DSWx-HLS_T11SPV_20250601T181502Z_20250605T123927Z_L8_30_v'
        for version in ('1.0.1','1.0-unverified','2.0'):
            product=base+version
            record=dict(id='G-fixture',producer_granule_id=product,time_start='2025-06-01T18:15:02Z',
                        links=[dict(href='https://archive.podaac.earthdata.nasa.gov/'+product+'_B01_WTR.tif')])
            budget=QueueBudget({'feed':{'entry':[record]}})
            out=p.cmr_discovery(request(),budget)
            self.assertTrue(out['evidence']);self.assertFalse(out['candidates']);self.assertFalse(out['metrics'])
            self.assertEqual(len(budget.urls),1)
            self.assertTrue(any('withheld' in note for note in out['missing']))
            self.assertNotIn('No bounded', ' '.join(out['missing']))
            self.assertTrue(out['evidence'][0]['sourceVersion'].endswith(version if version=='2.0' else 'processing-unverified'))

    def test_cmr_current_processing_is_conditional_known_header_candidate(self):
        product='OPERA_L3_DSWx-HLS_T11SPV_20250601T181502Z_20250605T123927Z_L8_30_v1.1'
        record=dict(id='G-fixture',producer_granule_id=product,time_start='2025-06-01T18:29:02Z',
            links=[dict(href='https://archive.podaac.earthdata.nasa.gov/'+product+'_B01_WTR.tif')])
        budget=QueueBudget({'feed':{'entry':[record]}})
        out=p.cmr_discovery(request(),budget)
        self.assertEqual(len(out['candidates']),1)
        self.assertEqual(out['candidates'][0]['version'],'1.1')
        self.assertEqual(out['candidates'][0]['assets']['water']['expectedProcessingVersion'],'1.1')
        self.assertFalse(out['metrics']);self.assertEqual(len(budget.urls),1)
        self.assertTrue(any('conditional' in note for note in out['evidence'][0]['quality']['notes']))
        self.assertTrue(out['evidence'][0]['sourceVersion'].endswith(':1.1'))

    def test_cmr_ambiguous_original_asset_is_withheld_in_every_link_order(self):
        product='OPERA_L3_DSWx-HLS_T11SPV_20250601T181502Z_20250605T123927Z_L8_30_v1.1'
        a={'href':'https://archive.podaac.earthdata.nasa.gov/path-a/'+product+'_B01_WTR.tif'}
        b={'href':'https://archive.podaac.earthdata.nasa.gov/path-b/'+product+'_B01_WTR.tif'}
        for links in permutations([a,b,a]):
            record=dict(id='G-fixture',producer_granule_id=product,time_start='2025-06-01T18:29:02Z',links=list(links))
            out=p.cmr_discovery(request(),QueueBudget({'feed':{'entry':[record]}}))
            self.assertTrue(out['evidence']);self.assertFalse(out['candidates']);self.assertFalse(out['metrics'])
            self.assertTrue(any('ambiguous' in note for note in out['missing']))
        # Identical repeated references do not create ambiguity.
        record['links']=[a,a]
        out=p.cmr_discovery(request(),QueueBudget({'feed':{'entry':[record]}}))
        self.assertEqual(len(out['candidates']),1)

    def test_cmr_timing_admission_preserves_metadata_and_rejects_unverified_days(self):
        product='OPERA_L3_DSWx-HLS_T11SPV_20250601T181502Z_20250605T123927Z_L8_30_v1.0'
        record=dict(id='G-fixture',producer_granule_id=product,
            links=[dict(href='https://archive.podaac.earthdata.nasa.gov/'+product+'_B01_WTR.tif')])
        # CMR centre-sensing and filename scene-start instants are not identical.
        # A different time on the same UTC day stays explicitly source-reported.
        for time in ('2025-06-01T18:29:02.801Z','2025-06-01T20:29:02.801+02:00'):
            out=p.cmr_discovery(request(),QueueBudget({'feed':{'entry':[dict(record,time_start=time)]}}))
            self.assertEqual(len(out['candidates']),1)
            self.assertTrue(out['candidates'][0]['date'].startswith('2025-06-01T18:29:02'))
        for time in ('2025-06-02T18:29:02Z','2025-06-01garbage','2025-06-01T18:29:02', '2025-06-01T18:29:02-00:00','2025-06-01T18:29:02+00:99'):
            out=p.cmr_discovery(request(),QueueBudget({'feed':{'entry':[dict(record,time_start=time)]}}))
            self.assertTrue(out['evidence']);self.assertFalse(out['candidates']);self.assertFalse(out['metrics'])
            self.assertTrue(any('timing' in note.lower() for note in out['missing']))

    def test_historical_public_pin_never_becomes_current_aoi(self):
        from pathlib import Path
        root=Path(__file__).resolve().parents[2]/'public/data'
        raw=(root/'processed-water.json').read_bytes();history=(root/'water-history.json').read_bytes()
        r=request('water','2023-03-30','2023-04-02')
        out=p.historical_water(r,QueueBudget(raw,history))
        self.assertEqual(out['observations'],0)
        self.assertNotEqual(out['evidence'][0]['geometry'],r['area'])
        self.assertIn('Entire',out['metrics'][0]['description'])
        self.assertTrue(all(e['public'] for e in out['evidence']))
        changed=json.loads(raw);changed['source']['commit']='wrong'
        with self.assertRaisesRegex(ProviderError,'pinned_provenance_changed'):p.historical_water(r,QueueBudget(changed))


class Response(io.BytesIO):
    def __init__(self,data,url,headers=None,status=200):super().__init__(data);self.url=url;self.headers=headers or {};self.status=status
    def geturl(self):return self.url


class NetworkTests(unittest.TestCase):
    def test_allowlist_credentials_and_signed_urls(self):
        for u in ['http://api.weather.gov/points/1,1','https://api.weather.gov.evil.test/points/1,1',
                  'https://user:password@api.weather.gov/points/1,1','https://api.weather.gov/points/1,1?token=private',
                  'https://nasa.r8volt.com/api/assessments/secret','https://api.weather.gov:444/points/1,1',
                  'https://api.weather.gov/points/%2e%2e/private','https://api.weather.gov/points/../private']:
            with self.subTest(u=u),self.assertRaises(ProviderError):vetted_url(u)

    @patch('service.observatory.net.socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))])
    def test_shared_budget_counts_received_bytes_and_content_hash(self,_):
        shared=TransferBudget(200);b=Budget(transfer_bytes=200,transfer=shared)
        u='https://api.weather.gov/points/1,1'
        with patch.object(b.opener,'open',side_effect=lambda *a,**k:Response(b'{"ok":true}',u,{'Content-Length':'11'})):
            t=b.fetch(u,max_bytes=20);self.assertEqual(t.sha256,hashlib.sha256(t.data).hexdigest())
            self.assertEqual(shared.transferred,11);self.assertEqual(shared.reserved,0)
        shared.reserve(5);shared.settle(5,5);self.assertEqual(b.used,16)

    @patch('service.observatory.net.socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))])
    def test_unknown_length_oversize_and_http_error_sanitized(self,_):
        b=Budget(transfer_bytes=100);u='https://api.weather.gov/points/1,1'
        with patch.object(b.opener,'open',return_value=Response(b'x'*30,u)):
            with self.assertRaisesRegex(ProviderError,'response_too_large'):b.fetch(u,max_bytes=20)
        self.assertEqual(b.used,21);self.assertEqual(b.transfer.reserved,0)
        with patch.object(b.opener,'open',side_effect=HTTPError(u,403,'private-token-data',{},None)):
            with self.assertRaisesRegex(ProviderError,'^access_gate$'):b.fetch(u,max_bytes=20)

    def test_private_dns_no_connection_and_deadline(self):
        b=Budget();u='https://api.weather.gov/points/1,1'
        with patch('service.observatory.net.socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]),patch.object(b.opener,'open') as op:
            with self.assertRaisesRegex(ProviderError,'address_not_public'):b.fetch(u)
            op.assert_not_called()
        b.started-=2000
        with self.assertRaisesRegex(ProviderError,'time_budget_exceeded'):b.fetch(u)

    def test_redirect_vets_target_before_connect_and_closes_body(self):
        from urllib.request import Request
        handler=_VettedRedirects();fp=io.BytesIO(b'x'*1000)
        with self.assertRaisesRegex(ProviderError,'url_not_allowlisted'):
            handler.http_error_302(Request('https://api.weather.gov/points/1,1'),fp,302,'redirect',{'Location':'https://localhost/private'})
        self.assertTrue(fp.closed)


if __name__=='__main__':unittest.main()
