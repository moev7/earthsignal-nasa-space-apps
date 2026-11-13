"""Finite native TIFF decoder; isolates GDAL's GIL from the bounded range proxy."""
import io
import json
import re
import sys
import numpy as np
from .native import decode_tiff_window,MAX_PIXELS

def main():
    raw=sys.stdin.buffer.read(4097)
    if len(raw)>4096:raise ValueError('Oversized decoder spec')
    spec=json.loads(raw)
    if set(spec)!={'url','bounds','pixelWindow'} or not re.fullmatch(r'/vsicurl/http://127\.0\.0\.1:\d{1,5}/[a-f0-9]{48}/0\.h5',spec['url']):raise ValueError('Decoder requires the job-local range proxy')
    values,valid,grid=decode_tiff_window(spec['url'],spec['bounds'],spec['pixelWindow'])
    if values.size>MAX_PIXELS:raise ValueError('Decoder pixel budget exceeded')
    out=io.BytesIO();np.savez_compressed(out,values=values,valid=valid,grid=np.asarray(json.dumps(grid,allow_nan=False)))
    if out.tell()>12*1024**2:raise ValueError('Decoder output budget exceeded')
    sys.stdout.buffer.write(out.getvalue())

if __name__=='__main__':main()
