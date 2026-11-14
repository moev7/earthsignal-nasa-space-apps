import type {CauseId,Experiment} from './cause-experiment-model';
export type MechanismStep={title:string;detail:string;snapshot:Experiment};
const scene=(amount:number,peak=amount,second=0):Experiment=>({amount,peak,second,alternative:false});
/** Fresh schematic starting states, not calibrated physics or a recovery clock. */
export const MECHANISM_STEPS:Record<CauseId,MechanismStep[]>={
 groundwater:[
  {title:'Water leaves',detail:'Pumping removes water held between grains. The water pressure falls.',snapshot:scene(.25)},
  {title:'Load transfers',detail:'Less water pressure leaves the sediment grains carrying more of the same weight above them.',snapshot:scene(.6)},
  {title:'Layers compact',detail:'Fine layers can lose pore space. Some compression remains even if water returns.',snapshot:scene(1)},
 ],
 irrigation:[
  {title:'Demand grows',detail:'More irrigated fields need a water supply. This example adds groundwater-fed demand.',snapshot:scene(.25)},
  {title:'Wells supply it',detail:'Where surface supplies are unavailable, wells can supply the growing irrigation demand.',snapshot:scene(.6)},
  {title:'Pressure falls',detail:'Sustained groundwater withdrawal can lower pressure and compact fine layers.',snapshot:scene(1)},
 ],
 drought:[
  {title:'Rainfall drops',detail:'Less rain arrives while pumping is held steady in this comparison.',snapshot:scene(.25)},
  {title:'Refill slows',detail:'Less water replenishes the aquifer. Rainfall and recharge are related, but are not the same quantity.',snapshot:scene(.6)},
  {title:'Storage falls',detail:'With the same withdrawal and less replenishment, the groundwater shortfall grows.',snapshot:scene(1)},
 ],
 geology:[
  {title:'Pressure falls',detail:'Apply the same illustrative water-pressure loss to both materials.',snapshot:scene(.3)},
  {title:'Fine layers squeeze',detail:'The fine-grained layer compresses more in this example; geology and past stresses matter.',snapshot:scene(1)},
  {title:'Water returns',detail:'Water can return without reopening all the pore space lost from the fine layer.',snapshot:scene(0,1)},
 ],
 urban:[
  {title:'Add weight',detail:'Added weight can compress soft ground locally, without pumping groundwater.',snapshot:scene(1)},
  {title:'Seal the surface',detail:'Paving can divert rainfall toward runoff instead of local infiltration.',snapshot:scene(0,0,1)},
  {title:'Two pathways',detail:'Loading and paving act through different pathways. This example shows them together.',snapshot:scene(1,1,1)},
 ],
};
export type ClueKind='level'|'bowl'|'seasonal'|'wells'|'map'|'rain'|'reservoir'|'break'|'core'|'recovery'|'load'|'runoff';
export const INDICATOR_VIEWS:Record<CauseId,{label:string;kind:ClueKind;reading:string}[]>={
 groundwater:[
  {label:'Well levels',kind:'level',reading:'Compare repeated well readings. A falling level is a clue to changing groundwater conditions.'},
  {label:'Sinking pattern',kind:'bowl',reading:'Compare the shape of a subsidence bowl with pumping locations. Overlap alone does not establish the cause.'},
  {label:'Seasonal timing',kind:'seasonal',reading:'Compare water-use seasons with ground motion. Similar timing is a clue, not proof of a single cause.'},
 ],
 irrigation:[
  {label:'Seasonal timing',kind:'seasonal',reading:'Look for repeated growing-season changes, then compare them with pumping and ground-motion records.'},
  {label:'Deeper wells',kind:'wells',reading:'Check well construction and water-level records. Deeper wells can indicate pressure on supplies; depth alone is not proof.'},
  {label:'Fields & motion',kind:'map',reading:'Compare irrigated land with motion patterns. A shared location calls for closer investigation.'},
 ],
 drought:[
  {label:'Rainfall history',kind:'rain',reading:'Compare several years of rainfall with a suitable long-term reference, rather than one dry month.'},
  {label:'Water levels',kind:'reservoir',reading:'Shrinking lakes or reservoirs can signal water stress. They do not directly measure groundwater storage.'},
  {label:'A change in pace',kind:'break',reading:'Check whether a change in motion coincides with a dry spell, while considering changes in pumping and other factors.'},
 ],
 geology:[
  {label:'Borehole layers',kind:'core',reading:'Borehole logs reveal sand, silt and clay layers that a surface map cannot show.'},
  {label:'Patterns differ',kind:'map',reading:'If pumping and motion patterns differ, investigate geology, past stresses and other processes.'},
  {label:'Recovery test',kind:'recovery',reading:'Compare recovering water levels with ground height. Limited height recovery can indicate inelastic compaction.'},
 ],
 urban:[
  {label:'New loading',kind:'load',reading:'Compare construction and ground conditions. A heavy load over compressible material can produce local settlement.'},
  {label:'Rain pathways',kind:'runoff',reading:'Compare open and paved surfaces. Drainage, geology and the wider catchment affect where water goes.'},
  {label:'Local settling',kind:'bowl',reading:'Compare motion around a structure with nearby ground. A local pattern needs an engineering and geological assessment.'},
 ],
};
