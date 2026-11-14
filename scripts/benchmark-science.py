#!/usr/bin/env python3
"""Offline, bounded capacity evidence. Synthetic workloads are not accuracy tests.

Run from the repository with the science-service Python. Each case gets a fresh
process so peak RSS is meaningful; no network, credentials or production writes.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import resource
import statistics
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
CASES=('radar-100','radar-250','radar-500','radar-1000','seasonal-2000')


def run_case(name):
    if name.startswith('radar-'):
        import numpy as np
        from service.processing import compare_arrays
        side=int(name.split('-')[1]); shape=(side,side)
        before=np.ones(shape,dtype=np.float64);after=np.full(shape,2.,dtype=np.float64)
        masks=np.ones(shape,dtype=np.uint8);masks.ravel()[::17]=0
        start=time.perf_counter()
        difference,_,_,common,stats,coverage=compare_arrays(before,after,masks,masks)
        elapsed=time.perf_counter()-start
        assert abs(stats['medianDb']-3.010299956639812)<1e-10
        assert coverage['commonValidPixels']==int(common.sum())
        result=dict(pixels=side*side,coreSeconds=elapsed,validPixels=coverage['commonValidPixels'],medianDb=stats['medianDb'],outputBytes=difference.nbytes)
    else:
        from datetime import date,timedelta
        from service.observatory.seasonal_trend import seasonal_trend
        start_date=date(2021,1,1)
        points=[]
        for i in range(2000):
            d=start_date+timedelta(days=i)
            points.append(dict(date=d.isoformat(),value=100+20*d.month+2*(d.year-2021),quality='Approved'))
        series=dict(id='usgs-discharge',label='Synthetic benchmark station',unit='ft^3/s',evidenceIds=['synthetic'],points=points)
        elapsed=[]
        for _ in range(20):
            start=time.perf_counter();trend=seasonal_trend(series);elapsed.append(time.perf_counter()-start)
        assert trend['status']=='descriptive' and trend['slope']==2
        result=dict(points=2000,repetitions=20,coreSeconds=statistics.median(elapsed),maxCoreSeconds=max(elapsed),years=trend['years'],pairs=trend['pairCount'])
    peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result.update(case=name,peakRssBytes=peak if sys.platform=='darwin' else peak*1024)
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--case',choices=CASES);args=parser.parse_args()
    if args.case:
        print(json.dumps(run_case(args.case),allow_nan=False));return
    cases=[]
    for name in CASES:
        start=time.perf_counter()
        result=json.loads(subprocess.check_output([sys.executable,str(Path(__file__).resolve()),'--case',name],cwd=ROOT,text=True,timeout=60))
        result['processSeconds']=time.perf_counter()-start;cases.append(result)
    print(json.dumps(dict(schemaVersion='1.0',kind='synthetic-capacity-benchmark',python=platform.python_version(),platform=platform.platform(),cpuCount=os.cpu_count(),cases=cases,
        limitations=['Synthetic CPU calculations only; no acquisition discovery, remote transfer, raster decode, export or multi-user latency measured.',
                     'Peak RSS is per subprocess; includes imports but excludes the web/API/worker and operating-system memory.',
                     'Scientific accuracy, new hardware speed and GPU/model inference cannot be inferred from these timings.']),indent=2,allow_nan=False))


if __name__=='__main__':main()
