"""Offline reproduction of the small frozen USGS local-receipt example."""
import hashlib
import json
from pathlib import Path
import tempfile
from .observatory.net import Transfer
from .observatory.providers import usgs_daily
from .observatory.vintages import ObservationVintageLedger
from .observatory.vintage_contract import validate_gauge_vintage


def verify():
    source=Path(__file__).resolve().parent.parent/'examples/gauge-vintage-receipt'
    transfers=[]
    for i in range(2):
        raw=(source/f'response-{i}.json').read_bytes()
        if len(raw)>2*1024**2:raise ValueError('Frozen response exceeds bound')
        receipt=json.loads((source/f'response-{i}-receipt.json').read_text())
        if hashlib.sha256(raw).hexdigest()!=receipt['sha256']:raise ValueError('Frozen response hash mismatch')
        transfers.append(Transfer(raw,receipt['url'],receipt['sha256'],receipt['retrievedAt']))
    expected=json.loads((source/'capture.json').read_text())
    if len(expected)!=1:raise ValueError('Expected one frozen capture')
    snapshot=expected[0]['snapshot']
    request=dict(schemaVersion='1.0',domain='water',question='change',start=snapshot['start'],end=snapshot['end'],
        area=dict(type='Polygon',coordinates=[[[-114.8,36],[-114.7,36],[-114.7,36.05],[-114.8,36.05],[-114.8,36]]]),
        options=dict(gaugeId=snapshot['identity']['station']))
    class FrozenBudget:
        def fetch(self,url,**kwargs):
            if not transfers:raise ValueError('Unexpected provider read')
            transfer=transfers.pop(0)
            if transfer.url!=url:raise ValueError('Frozen request identity mismatch')
            return transfer
    captures=[]
    with tempfile.TemporaryDirectory() as tmp:
        ledger=ObservationVintageLedger(Path(tmp),'public-example-replay',reserve_bytes=0)
        def capture(payload):
            receipt=ledger.capture(payload['identity'],payload['records'],station_time_properties=payload['stationTime'],
                response_hash=payload['responseHash'],metadata_hash=payload['metadataHash'],received_at=payload['receivedAt'])
            current=ledger.as_of(payload['identity'],payload['receivedAt'],start=request['start'],end=request['end'])
            result=dict(status='captured',receipt=receipt,snapshot=current)
            validate_gauge_vintage(result,request,payload['receivedAt']);captures.append(result)
        out=usgs_daily(request,FrozenBudget(),capture=capture)
        if transfers or captures!=expected:raise ValueError('Frozen receipt reproduction mismatch')
    return dict(status='reproduced',observedDays=out['observations'],snapshotHash=snapshot['snapshotHash'],
        availability='local-receipt-only',fieldAccuracy='not evaluated',forecastSkill='not evaluated')


if __name__=='__main__':print(json.dumps(verify()))
