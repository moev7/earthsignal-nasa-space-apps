import { formatPeriod, type BundleManifest, type Loadable } from '@/features/ground-truth/data/nisar';
export type MissionId = 'nisar'|'sentinel-1'|'envisat'|'alos'|'landsat'|'grace';
export type MissionKind = 'radar'|'optical'|'gravity';
export const MISSION_VIEWS: Record<MissionId,{name:string;kind:MissionKind;signal:string;use:string;limit:string;action:string;result:string;wavelength?:number;source:string}> = {
  nisar:{name:'NISAR',kind:'radar',signal:'L + S radar',use:'Repeated ground-motion mapping',limit:'Needs repeat observations and careful processing',action:'Lower the ground',result:'The radar path changes. Comparing repeated signals can reveal ground motion.',wavelength:24,source:'https://science.nasa.gov/mission/nisar/mission-overview/'},
  'sentinel-1':{name:'Sentinel-1',kind:'radar',signal:'C-band radar',use:'Repeated ground-motion mapping',limit:'Vegetation and surface changes can disrupt the signal',action:'Lower the ground',result:'The radar path changes. Comparing repeated signals can reveal ground motion.',wavelength:5.6,source:'https://sentiwiki.copernicus.eu/web/s1-applications'},
  envisat:{name:'ENVISAT',kind:'radar',signal:'C-band radar',use:'Earlier ground-motion history',limit:'Historical acquisitions; mission ended in 2012',action:'Lower the ground',result:'Archived repeat visits can reveal earlier ground motion. This is a teaching diagram.',wavelength:5.6,source:'https://earth.esa.int/eogateway/missions/envisat'},
  alos:{name:'ALOS / ALOS-2',kind:'radar',signal:'L-band radar',use:'Ground-motion studies, including vegetated terrain',limit:'Radar does not directly measure groundwater',action:'Lower the ground',result:'The radar path changes. Longer wavelengths can retain useful signals through some vegetation.',wavelength:24,source:'https://www.eorc.jaxa.jp/ALOS/en/alos/sensor/palsar_e.htm'},
  landsat:{name:'Landsat 8 / 9',kind:'optical',signal:'Visible & infrared light',use:'Land cover and surface-water context',limit:'Does not supply a ground-motion rate',action:'Change the land cover',result:'The pattern of reflected light changes. This shows surface cover, not a subsidence measurement.',source:'https://science.nasa.gov/mission/landsat/oli/'},
  grace:{name:'GRACE-FO',kind:'gravity',signal:'Changes in gravity',use:'Regional total-water-storage change',limit:'Cannot resolve a street or isolate groundwater alone',action:'Change stored water',result:'Changing mass affects gravity and the pair’s spacing. Other information is needed to separate groundwater.',source:'https://earth.gsfc.nasa.gov/hydro/missions/gravity-recovery-and-climate-experiment-follow-mission-grace-fo'},
};
export type MissionConnection = {state:'loading'|'error'|'ready'|'reference';title:string;detail:string};
export function missionConnection(id:MissionId,result:Loadable<{manifest:BundleManifest}>|null):MissionConnection {
  if(id!=='nisar')return {state:'reference',title:'Reference mission in this public comparison',detail:'No verified result from this mission is connected here. The wider story may use labelled demonstrations or published references.'};
  if(!result||result.status==='loading')return {state:'loading',title:'Checking the connected NISAR result…',detail:'Dates and availability appear after the frozen bundle passes verification.'};
  if(result.status==='error')return {state:'error',title:'NISAR result could not be verified',detail:'No measured result is claimed here. The conceptual comparison remains available.'};
  const m=result.data.manifest;
  return {state:'ready',title:`Verified ${m.source.product_status} result · ${m.source.sensor}`,detail:`Tehran · ${formatPeriod(m)}.${/S.band/i.test(m.source.sensor)?'':' No S-band result is connected.'}`};
}
/** Centimetre axis and constant arbitrary amplitude: wavelength, not image resolution. */
export function wavelengthPath(wavelength:number):string {
  if(!Number.isFinite(wavelength)||wavelength<=0)return '';
  return Array.from({length:193},(_,i)=>{const cm=i/4;return `${i?'L':'M'}${(20+cm*4).toFixed(2)} ${(28-Math.sin(cm/wavelength*Math.PI*2)*13).toFixed(2)}`;}).join(' ');
}
