"""Explicit operator publication of independently checked SAR study revisions.

This command never runs from a public request or from the job worker. A review
receipt binds the exact candidate manifest; the receipt is an operator record,
not a cryptographic assertion of reviewer identity.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from .sar.jobs import verify


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()


def _publish(candidate, public_root, study_id, title, review, expected_registry, *, rcm_approved=False):
    candidate, public_root = Path(candidate), Path(public_root)
    if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*',study_id) or not 1<=len(title)<=160:
        raise ValueError('Invalid public study identity')
    request=json.loads((candidate/'provenance.json').read_text())['request']
    result=verify(candidate,request)
    original=(candidate/'manifest.json').read_bytes()
    if (set(review)!={'decision','manifestSha256','verification','reviewer','publicLocation'} or
        review['decision']!='approved' or review['verification']!='source-values-matched' or
        review['manifestSha256']!=sha(original) or not review['publicLocation'] or
        not isinstance(review['reviewer'],str) or not re.fullmatch('[A-Za-z0-9_.:-]{1,100}',review['reviewer'])):
        raise ValueError('A matching independent source-value review is required')
    source=result['sourceId']
    if source=='saocom':raise ValueError('A publication-compatible CONAE grant is not configured')
    if source=='rcm' and not rcm_approved:raise ValueError('RCM public license approval is required')
    registry_path=public_root/'data/challenge/studies.json'
    prior=registry_path.read_bytes()
    if sha(prior)!=expected_registry:raise ValueError('Public registry changed; re-review the publication')
    registry=json.loads(prior)
    if registry.get('schemaVersion')!='1.0':raise ValueError('Unsupported public registry')
    provenance=json.loads((candidate/'provenance.json').read_text())
    # The candidate is an explicitly selected public-location experiment, never
    # a database row. Only this scientific provenance allowlist is published.
    safe_provenance={k:provenance[k] for k in ('schemaVersion','method','request','inputs','transferBytes') if k in provenance}
    def check_safe(value):
        if isinstance(value,dict):
            if any(re.search('password|token|secret|cookie|authorization|owner|email|private',str(k),re.I) for k in value):
                raise ValueError('Private fields cannot enter public science')
            for child in value.values():check_safe(child)
        elif isinstance(value,list):
            for child in value:check_safe(child)
        elif isinstance(value,str) and re.search(r'(?:[?&](?:X-Amz-|token=|signature=)|/etc/|/var/lib/)',value,re.I):
            raise ValueError('Private paths or credential URLs cannot enter public science')
    check_safe(safe_provenance)
    check_safe(result['records'])
    files={'values.json':(candidate/'values.json').read_bytes(),'preview.png':(candidate/'preview.png').read_bytes(),
           'provenance.json':encoded(safe_provenance)}
    years=', '.join(sorted({str(r.get('acquiredAt',''))[:4] for r in result['records']}))
    rights={
        'radarsat-1':{'license':'Open Government Licence – Canada','url':'https://open.canada.ca/en/open-government-licence-canada','credit':'RADARSAT-1 imagery © Government of Canada. RADARSAT is an official mark of the Canadian Space Agency.'},
        'rcm':{'license':'RCM Public User License, CSA-RC-AGR-0005 Rev 1.0','licenseSha256':'a7486d315775c7009b1dd529f3f31ea52a9d158297cf4d400c6dcdbdf3ee79b1','url':'https://www.asc-csa.gc.ca/eng/satellites/radarsat/access-to-data/about.asp','credit':f'RADARSAT Constellation Mission Imagery © Government of Canada ({years}). RADARSAT is an official mark of the Canadian Space Agency.'},
        'nisar':{'license':'NASA Earth science data policy','url':'https://nisar-docs.asf.alaska.edu/','credit':'NASA–ISRO NISAR; Alaska Satellite Facility DAAC.'},
        'uavsar':{'license':'NASA/JPL data use policy','url':'https://uavsar.jpl.nasa.gov/','credit':'NASA/JPL-Caltech UAVSAR; Alaska Satellite Facility DAAC.'},
    }[source]
    manifest={k:result[k] for k in ('sourceId','operation','channel','quantity','unit','grid','coverage','stats','records','method','processedAt')}
    manifest.update(schema='earthsignal.sar-public-study/1',id=study_id,title=title,rights=rights,
        notices=[n for n in result['notices'] if 'Private analytical' not in n]+[
            'This is a reviewed source-specific observation. It does not establish a cause, hazard or cross-sensor trend.',
            'Source-pixel grids are not geographic maps. Calibration-withheld magnitudes are not backscatter in dB.'],
        review={k:review[k] for k in ('manifestSha256','verification','reviewer')},
        files={name:{'bytes':len(raw),'sha256':sha(raw)} for name,raw in files.items()})
    raw=encoded(manifest);revision=sha(raw)[:16]
    relative=Path('data/sar')/study_id/revision
    target=public_root/relative;target.parent.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='.candidate-',dir=target.parent))
    try:
        for name,data in {**files,'manifest.json':raw}.items():(stage/name).write_bytes(data)
        for name,data in files.items():
            if sha((stage/name).read_bytes())!=sha(data):raise ValueError('Publication staging checksum mismatch')
        if target.exists():
            if any((target/name).read_bytes()!=data for name,data in {**files,'manifest.json':raw}.items()):
                raise ValueError('Immutable public revision already exists with different content')
        else:os.replace(stage,target)
        dates=[str(r.get('acquiredAt') or '')[:10] for r in result['records']]
        if not dates or any(not re.fullmatch(r'\d{4}-\d{2}-\d{2}',d) for d in dates):raise ValueError('Public observation dates are missing')
        kinds={'native-observation':'native-observation','backscatter-observation':'radar-backscatter-observation',
               'backscatter-change':'radar-backscatter-change','los-displacement':'los-displacement','pixel-offset':'pixel-offset'}
        entry={'id':study_id,'title':title,'kind':kinds[result['operation']],'unit':result['unit'],'sourceId':source,
            'revision':revision,'manifestUrl':'/'+str(relative/'manifest.json'),'manifestSha256':sha(raw),'manifestBytes':len(raw),
            'period':{'start':min(dates),'end':max(dates)},'maturity':next(iter({r['maturity'] for r in result['records']})) if source=='nisar' and len({r['maturity'] for r in result['records']})==1 and result['records'][0]['maturity'] in ('provisional','validated') else 'source-defined','coverageFraction':result['coverage']['fraction'],
            'href':f'/studies/{study_id}?revision={revision}','notice':result['quantity']+'; native-grid source observation, with source-specific limitations.',
            'files':manifest['files']}
        if sha(registry_path.read_bytes())!=expected_registry:raise ValueError('Registry changed during staging; previous publication preserved')
        registry['studies']=[entry]+[s for s in registry['studies'] if (s['id'],s['revision'])!=(study_id,revision)]
        temporary=registry_path.with_suffix('.new')
        with temporary.open('wb') as f:f.write(encoded(registry));f.flush();os.fsync(f.fileno())
        os.replace(temporary,registry_path)
        return entry
    finally:
        if stage.exists():shutil.rmtree(stage)


def publish(candidate, public_root, study_id, title, review, expected_registry, *, rcm_approved=False):
    import fcntl
    # Keep operator synchronization outside the web-served artifact tree.
    root=Path(public_root).resolve().parent
    with (root/'.earthsignal-sar-publication.lock').open('a') as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        return _publish(candidate,public_root,study_id,title,review,expected_registry,rcm_approved=rcm_approved)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ['candidate','public-root','id','title','review','expected-registry-sha256']:p.add_argument('--'+flag,required=True)
    p.add_argument('--rcm-approved',action='store_true')
    a=p.parse_args()
    entry=publish(a.candidate,a.public_root,a.id,a.title,json.loads(Path(a.review).read_text()),a.expected_registry_sha256,rcm_approved=a.rcm_approved)
    print(json.dumps(entry,indent=2))

if __name__=='__main__':main()
