"""Private offline area-method experiments; no field or map-accuracy promotion."""
import argparse
from copy import deepcopy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys

from .forecast_policy import _constant, _float, _pairs, canonical_json, write_new

MAX_BYTES = 2 * 1024**2
HASH = re.compile(r'[0-9a-f]{64}\Z')


def exact(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError('Exact object fields required')


def text(value, maximum=128):
    if type(value) is not str or not value or value != value.strip() or len(value)>maximum or not value.isprintable():
        raise ValueError('Invalid text')


def digest(value):
    if type(value) is not str or not HASH.fullmatch(value):
        raise ValueError('Invalid hash')


def instant(value):
    text(value, 40)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})',value):
        raise ValueError('Explicit aware timestamp required')
    if not value.endswith('Z'):
        hours,minutes=map(int,value[-5:].split(':'))
        if hours>23 or minutes>59 or value.endswith('-00:00'):
            raise ValueError('Invalid or unknown timezone offset')
    result=datetime.fromisoformat(value.replace('Z','+00:00'))
    if result.utcoffset() is None:
        raise ValueError('Naive time')
    return result


def validate_context(context):
    exact(context, ['studyId','stage','sourceEvidence','geometryHash','protocolFrozenAt','selectionFrozenAt','outcomesFrozenAt','referenceQuality','reviewEvidenceHash'])
    text(context['studyId']);digest(context['geometryHash'])
    if context['stage'] not in ('development','evaluation') or context['referenceQuality'] not in ('unverified','externally-reviewed'):
        raise ValueError('Explicit stage/quality required')
    if context['reviewEvidenceHash'] is not None:
        digest(context['reviewEvidenceHash'])
    if context['referenceQuality']=='externally-reviewed' and context['reviewEvidenceHash'] is None:
        raise ValueError('Review evidence hash required for declaration')
    protocol,selection,outcomes=(instant(context[k]) for k in ('protocolFrozenAt','selectionFrozenAt','outcomesFrozenAt'))
    if not protocol<=selection<=outcomes:
        raise ValueError('Protocol/selection must precede outcome freeze')
    sources=context['sourceEvidence']
    if type(sources) is not list or not 1<=len(sources)<=16:
        raise ValueError('Bounded source lineage required')
    seen=set()
    for source in sources:
        exact(source,['id','sha256','observedAt']);text(source['id']);digest(source['sha256'])
        if source['id'] in seen or instant(source['observedAt'])>outcomes:
            raise ValueError('Duplicate or future source')
        seen.add(source['id'])


def experiment(value):
    exact(value,['schemaVersion','kind','evidenceKind','design','outcomes','context'])
    if type(value['schemaVersion']) is not int or value['schemaVersion']!=1 or value['kind']!='stratified-area-experiment':
        raise ValueError('Unsupported experiment')
    if value['evidenceKind'] not in ('synthetic-software-check','declared-reference-experiment'):
        raise ValueError('Explicit evidence kind required')
    validate_context(value['context'])
    from .stratified_area import estimate_area
    result=estimate_area(value['design'],value['outcomes'])
    development=value['context']['stage']=='development' or value['evidenceKind']=='synthetic-software-check'
    # This is an auditable declaration, not a verifier of how people gathered data.
    readiness='withheld-development-evidence' if development else 'requires-external-scientific-review'
    explanation=('This method can produce conditional estimates of the footprint of recorded categories within a declared equal-area-cell frame. '
                 'Sampling groups are weighted by their share of that frame; deliberately oversampled groups do not count as a larger share of the place. '
                 'Sampling error describes which cells were selected, and does not measure errors in interpreting the images, timing, location or area distortion. '
                 'The recorded target defines the category; a whole-cell category is not continuous water or vegetation cover. '
                 'This experiment establishes neither map accuracy, field truth, danger nor cause. Unknown answers remain unknown; no missing answer is filled in.')
    if result.get('pointEstimateStatus')=='withheld':
        explanation='Area estimates are withheld because a selected outcome is unfinished, unclear or not observable, or a positive sampling group has no selected observations. The missing evidence is retained; no answer is filled in. '+explanation
    elif result.get('samplingVarianceStatus')=='non-estimable':
        explanation='Point estimates are available, but sampling uncertainty cannot be estimated because a non-census group has only one selected observation. A new documented sampling plan is needed before uncertainty can be reported. '+explanation
    return {'schemaVersion':1,'kind':'stratified-area-experiment-result','private':True,
            'evidenceKind':value['evidenceKind'],'context':deepcopy(value['context']),'scientificReadiness':readiness,
            'scientificallyValidated':False,'fieldTruthEstablished':False,'mapAccuracyEstimated':False,
            'referenceErrorQuantified':False,'publicDecisionAuthority':False,
            'plainLanguage':explanation,'calculation':result}


def read_pinned(path, pin):
    digest(pin)
    with Path(path).open('rb') as stream:
        raw=stream.read(MAX_BYTES+1)
    if len(raw)>MAX_BYTES or hashlib.sha256(raw).hexdigest()!=pin:
        raise ValueError('Changed pin or oversized input')
    return json.loads(raw.decode('utf-8'),object_pairs_hook=_pairs,parse_constant=_constant,parse_float=_float)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True)
    parser.add_argument('--input-pin',required=True,help='Independently retained SHA-256 of exact input bytes')
    parser.add_argument('--output',required=True,help='New private artifact; never replace an existing path')
    args=parser.parse_args(argv)
    try:
        result=experiment(read_pinned(args.input,args.input_pin))
        result['inputFileSha256']=args.input_pin
        # Exactly the bytes the unchanged atomic writer will publish, including newline.
        if len((canonical_json(result)+'\n').encode('utf-8'))>MAX_BYTES:
            raise ValueError('Output limit')
        write_new(args.output,result)
        print(json.dumps({'status':'offline-conditional-area-experiment','scientificReadiness':result['scientificReadiness'],
                          'inputFileSha256':args.input_pin,'fieldTruthEstablished':False,'mapAccuracyEstimated':False}))
        return 0
    except (OSError,ValueError,TypeError,KeyError,OverflowError,RecursionError,UnicodeError,ImportError):
        print('Area experiment refused: invalid, changed or unsupported input, or unavailable output.',file=sys.stderr)
        return 2


if __name__=='__main__':
    raise SystemExit(main())
