"""CEOS-ARD RCM metadata: declared calibration and exact source validity codes."""
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit
import hashlib
from .net import SarError,vetted

APPROVED_PUBLIC_LICENSE_SHA256='a7486d315775c7009b1dd529f3f31ea52a9d158297cf4d400c6dcdbdf3ee79b1'

def verify_license(item,reader):
    url=item.get('assets',{}).get('eula_license',{}).get('href')
    if not isinstance(url,str):raise SarError('license_unknown','RCM product has no original public-license document')
    vetted(url)
    raw=reader.text(url,cap=256*1024)
    if hashlib.sha256(raw).hexdigest()!=APPROVED_PUBLIC_LICENSE_SHA256:
        raise SarError('license_changed','RCM source terms differ from the user-approved royalty-free Public User License; imagery is withheld')
    return {'licenseUrl':url,'licenseSha256':APPROVED_PUBLIC_LICENSE_SHA256}


def descriptor(item,channel,reader):
    assets=item.get('assets',{});metadata=assets.get('metadata',{});mask=assets.get('data_mask',{})
    if item.get('collection')!='rcm-ard' or not metadata.get('href') or not mask.get('href'):
        raise SarError('metadata_missing','RCM analysis requires its original ARD metadata and validity raster')
    raw=reader.text(metadata['href'])
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise SarError('metadata_unknown','XML entities are not supported')
    try:
        tree=ET.fromstring(raw)
        root=tree.find('CEOS-ARDProductAttributes')
        if root is None:raise ValueError()
        masknode=root.find('PerPixelMetadata/DataMask');codes=masknode.find('BitValues')
        if masknode.findtext('FileName')!=urlsplit(mask['href']).path.rsplit('/',1)[-1] or codes.findtext('ValidData')!='1' or codes.findtext('NoData')!='0':raise ValueError()
        declared={int(x.text) for x in codes}
        if any(not 0<=v<=255 for v in declared):raise ValueError()
        matches=[n for n in root.findall('BackscatterMeasurementData') if n.findtext('Polarization')==channel]
        if len(matches)!=1:raise ValueError()
        m=matches[0]
        if (m.findtext('BackscatterMeasurement')!='Gamma-0' or m.findtext('BackscatterConvention')!='linear power' or
            m.findtext('BackscatterConversionEq')!='10*log10(DN)' or m.findtext('DataType')!='Float' or m.findtext('BitsPerSample')!='32'):raise ValueError()
        science=assets.get(channel.lower(),{})
        if m.findtext('FileName')!=urlsplit(science['href']).path.rsplit('/',1)[-1]:raise ValueError()
        vetted(science['href']);vetted(mask['href'])
        return science,'gamma0','power',{'sourceMetadataSha256':hashlib.sha256(raw).hexdigest(),'sourceMetadataUrl':metadata['href'],
            'maskAsset':mask['href'],'maskCodes':sorted(declared),'validCode':1,
            'noiseRemovalApplied':root.findtext('NoiseRemoval/NoiseRemovalApplied'),
            'sourceFiltering':root.findtext('Filtering/FilterType'),'processor':root.findtext('DataAccess/SoftwareVersion')}
    except (ET.ParseError,AttributeError,ValueError,KeyError,TypeError):
        raise SarError('calibration_unknown','RCM calibration, channel or validity definition did not match the verified ARD contract') from None
