"""Select an actual compatible ASF pair; no fabricated activation fallback."""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from .config import Config
from .store import Store
from .api import capability
from .processing import ALGORITHM_VERSION, ProcessingError, lookup_source, validate_pair

# Existing workspace study regions only. Explicit crop is required: viewport != study extent.
REGIONS = {'lake-mead','tehran'}

def select_pairs(bbox, limit=3):
    query=urllib.parse.urlencode({'platform':'NISAR','processingLevel':'GCOV','bbox':','.join(map(str,bbox)),
                                  'output':'geojson','maxResults':'24'})
    url='https://api.daac.asf.alaska.edu/services/search/param?'+query
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):
            raise ValueError('Unexpected catalog redirect')
    with urllib.request.build_opener(NoRedirect()).open(url,timeout=30) as response:
        raw=response.read(1024*1024+1)
        if len(raw)>1024*1024:
            raise ValueError('Catalog response too large')
    features=json.loads(raw)['features']
    if len(features)>24:
        raise ValueError('Catalog response exceeds requested bound')
    candidates=[]
    # Exact-ID lookup again rather than relying on the discovery result alone.
    for feature in features:
        source=lookup_source(feature['properties']['fileID'])
        candidates.append(source)
    candidates.sort(key=lambda s:(s.get('startTime',''),s['fileID']))
    pairs=[]
    for before in candidates:
        for after in reversed(candidates):
            try:
                validate_pair(before,after)
                pairs.append((before,after,url))
                if len(pairs)>=limit:
                    return pairs
            except ProcessingError:
                continue
    if pairs:
        return pairs
    raise ValueError('No compatible chronological provisional GCOV pair in bounded current discovery')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region',choices=sorted(REGIONS),required=True)
    parser.add_argument('--bbox',type=float,nargs=4,required=True,metavar=('WEST','SOUTH','EAST','NORTH'))
    parser.add_argument('--owner',required=True,help='Internal owner ID for prepared study')
    parser.add_argument('--wait-seconds',type=int,default=1300)
    args=parser.parse_args()
    config=Config.environment()
    cap=capability(config)
    if not cap['ready']:
        print(cap['message'],file=sys.stderr)
        return 2
    store=Store(config)
    from .store import validate_request, cache_key
    # Select only a bounded set; science failures may justify the next deliberate candidate.
    pairs=select_pairs(args.bbox)
    rejections=[]
    science_failures={'incompatible_pair','chronology','same_acquisition','unsupported_product','unsupported_collection',
        'unsupported_mode','metadata_missing','metadata_invalid','source_id_mismatch','source_metadata_mismatch',
        'radiometry_unknown','mask_unknown','mask_grid','grid_metadata','grid_mismatch','grid_crs','no_overlap','no_valid_pixels'}
    for index,(before,after,query) in enumerate(pairs):
        request={'beforeId':before['fileID'],'afterId':after['fileID'],'bbox':args.bbox}
        validate_request(request)
        key=cache_key(request,ALGORITHM_VERSION)
        receipt=config.root/'selection'
        receipt.mkdir(exist_ok=True)
        rationale={'schemaVersion':'1.0','region':args.region,'request':request,'query':query,
           'selectedAt':time.time(),'candidateNumber':index+1,'candidateLimit':3,'previousRejections':list(rejections),
           'rationale':'Earliest/latest compatible chronological exact ASF IDs among at most 24 results; same track, frame, direction, release and provisional collection. Frequency A HHHH gamma0 and authoritative HDF5 mode/metadata/mask must still pass processing.',
           'catalogBefore':{k:before.get(k) for k in ('fileID','startTime','pathNumber','frameNumber','flightDirection','pgeVersion','collectionName')},
           'catalogAfter':{k:after.get(k) for k in ('fileID','startTime','pathNumber','frameNumber','flightDirection','pgeVersion','collectionName')}}
        # Persist decision before processing; publication attaches it to the manifest too.
        receipt_path=receipt/(key+'.json')
        if not receipt_path.exists():
            with receipt_path.open('x') as stream:
                json.dump(rationale,stream,indent=2,allow_nan=False)
                stream.flush()
                __import__('os').fsync(stream.fileno())
        else:
            saved=json.loads(receipt_path.read_text())
            if saved.get('request') != request:
                raise ValueError('Selection receipt conflict')
            rationale=saved
        job=store.submit(args.owner,request,'prepared-'+key,ALGORITHM_VERSION,selection=rationale)
        print(json.dumps({'jobId':job['id'],'rationalePath':str(receipt_path),'status':job['status']}))
        deadline=time.monotonic()+max(0,min(args.wait_seconds,1500))
        while job['status'] in ('queued','running') and time.monotonic()<deadline:
            time.sleep(1)
            job=store.get(args.owner,job['id'])
        if job['status']=='completed':
            store.pin(job['id'])
            print('Verified successful study pinned: '+job['id'])
            return 0
        if job['status']=='failed' and job['error']['code'] in science_failures:
            rejection={'beforeId':request['beforeId'],'afterId':request['afterId'],'jobId':job['id'],'code':job['error']['code']}
            rejections.append(rejection)
            # Keep rejection alongside the original immutable pre-processing rationale.
            (receipt/(key+'.rejection.json')).write_text(json.dumps(rejection,indent=2))
            continue
        # Auth/config/network/transfer/time/storage gates and cancellation never trigger another attempt.
        print('No prepared result; stopped at processing gate or pending job',file=sys.stderr)
        return 3
    print('No prepared result: bounded candidates failed science verification',file=sys.stderr)
    return 1

if __name__=='__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Prepared study unavailable; inspect nonsensitive job status and selection receipt',file=sys.stderr)
        sys.exit(1)
