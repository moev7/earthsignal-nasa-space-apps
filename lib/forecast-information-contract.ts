import { z } from 'zod';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v);
const time=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/).refine(v=>Number.isFinite(Date.parse(v))&&day.safeParse(v.slice(0,10)).success&&!v.endsWith('-00:00'));
// Preserve the six-digit receipt cutoff; Date.parse alone truncates microseconds.
function micros(v:string){const ms=Date.parse(v);if(!Number.isFinite(ms))return null;const fraction=(v.match(/\.(\d{1,6})/)?.[1]??'').padEnd(6,'0');return BigInt(ms)*BigInt(1000)+BigInt(fraction.slice(3)||'0');}
function hours(v:bigint){return Number(v)/1000000/3600;}
const count=z.number().int().min(0).max(2000);
const resolvedInterval=z.object({date:day,start:time,end:time,startUtc:time,endUtc:time,durationHours:z.number().finite().positive().max(25)}).strict().superRefine((v,ctx)=>{
  if(Date.parse(v.endUtc)<=Date.parse(v.startUtc)||Date.parse(v.start)!==Date.parse(v.startUtc)||Date.parse(v.end)!==Date.parse(v.endUtc)||(Date.parse(v.endUtc)-Date.parse(v.startUtc))/3600000!==v.durationHours)ctx.addIssue({code:'custom',message:'Station-day interval mismatch'});
});
const interval=z.union([resolvedInterval,z.object({date:day,start:z.null(),end:z.null(),startUtc:z.null(),endUtc:z.null(),durationHours:z.null()}).strict()]);
const attempt=z.object({horizonDays:z.number().int().min(1).max(7),status:z.enum(['future','partly_elapsed','expired','withheld']),reason:z.enum(['no_eligible_day','mixed_station_metadata','whole_target_after_issue','target_already_started','target_expired','station_time_withheld']),timingEligible:z.boolean(),observationCutoff:interval.nullable(),targetInterval:interval.nullable(),lagHours:z.number().finite().nullable(),leadStartHours:z.number().finite().nullable(),leadEndHours:z.number().finite().nullable(),ruleVersion:z.literal('usgs-nist-station-day-v1')}).strict();
export const forecastInformationSchema=z.object({
  method:z.literal('gauge-forecast-information-v1'),status:z.enum(['resolved','withheld']),reason:z.enum(['no_eligible_day','mixed_station_metadata']).nullable(),
  issueTime:time.refine(v=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)),snapshotHash:hash,informationHash:hash,availabilityBasis:z.literal('local-receipt-only'),
  identity:z.object({station:z.string().regex(/^USGS-\d{8,15}$/),timeSeriesId:z.string().min(1).max(128),parameter:z.literal('00060'),statistic:z.literal('00003'),unit:z.literal('ft^3/s')}).strict(),
  start:day,end:day,
  counts:z.object({calendarDays:count,attemptedRecords:count,retainedRecords:count,excludedRecords:count,unknownCalendarDays:count,nullWithdrawals:count,unresolvedStationTime:count,incompleteAtIssue:count}).strict(),
  exclusionReasons:z.object({null_withdrawal:count.optional(),unresolved_station_time:count.optional(),incomplete_at_issue:count.optional()}).strict(),
  latestRetainedDate:day.nullable(),
  stationTime:z.object({ruleVersion:z.literal('usgs-nist-station-day-v1'),registryHashes:z.array(hash).max(1),registrySource:z.literal('https://api.waterdata.usgs.gov/ogcapi/v1/collections/time-zone-codes/items?f=json'),dstRuleSource:z.literal('https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst'),minYear:z.literal(2007),reviewCeiling:z.literal('2026-12-31'),retainedMetadataCount:count,properties:z.object({country_code:z.string().max(32).nullable().optional(),time_zone_abbreviation:z.string().max(32).nullable().optional(),uses_daylight_savings:z.string().max(32).nullable().optional()}).strict().nullable(),stationPropertiesHash:hash.nullable(),metadataHash:hash.nullable()}).strict(),
  timingAttempts:z.array(attempt).min(1).max(7),limitations:z.array(z.string().max(500)).min(1).max(8),
}).strict().superRefine((r,ctx)=>{
  const c=r.counts,issue=micros(r.issueTime);
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(issue===null){fail('Invalid issue cutoff');return;}
  if(c.calendarDays!==1+(Date.parse(r.end)-Date.parse(r.start))/86400000||c.attemptedRecords+c.unknownCalendarDays!==c.calendarDays||c.retainedRecords+c.excludedRecords!==c.attemptedRecords||c.nullWithdrawals+c.unresolvedStationTime+c.incompleteAtIssue!==c.excludedRecords)fail('Information-set populations do not reconcile');
  if((r.exclusionReasons.null_withdrawal??0)!==c.nullWithdrawals||(r.exclusionReasons.unresolved_station_time??0)!==c.unresolvedStationTime||(r.exclusionReasons.incomplete_at_issue??0)!==c.incompleteAtIssue)fail('Information-set exclusion reasons do not reconcile');
  if((r.latestRetainedDate===null)!==(c.retainedRecords===0)||r.latestRetainedDate!==null&&(r.latestRetainedDate<r.start||r.latestRetainedDate>r.end))fail('Latest retained date mismatch');
  if(r.status==='resolved'&&(r.reason!==null||c.retainedRecords===0||r.stationTime.retainedMetadataCount!==1))fail('Resolved timing requires consistent metadata and a retained record');
  if(r.status==='withheld'&&r.reason===null)fail('Withheld timing needs a reason');
  const metadata=r.stationTime;
  const expectedReason=c.retainedRecords===0?'no_eligible_day':metadata.retainedMetadataCount!==1?'mixed_station_metadata':null;
  if(r.reason!==expectedReason||(r.status==='resolved')!==(expectedReason===null)||metadata.retainedMetadataCount>c.retainedRecords)fail('Information-set status does not match retained metadata');
  if(metadata.retainedMetadataCount===1?metadata.properties===null||metadata.stationPropertiesHash===null||metadata.metadataHash===null:metadata.properties!==null||metadata.stationPropertiesHash!==null||metadata.metadataHash!==null)fail('Uniform station metadata mismatch');
  for(const [i,a] of r.timingAttempts.entries()){
    if(i>0&&a.horizonDays<=r.timingAttempts[i-1].horizonDays)fail('Timing horizons must be unique and ordered');
    if(a.timingEligible!==(a.status==='future')||r.status==='withheld'&&(a.status!=='withheld'||a.timingEligible))fail('Timing eligibility mismatch');
    const reasons={future:'whole_target_after_issue',partly_elapsed:'target_already_started',expired:'target_expired',withheld:r.reason??'station_time_withheld'};
    if(a.reason!==reasons[a.status])fail('Target reason does not match timing status');
    if(r.status==='resolved'&&(!a.observationCutoff?.endUtc||a.observationCutoff.date!==r.latestRetainedDate))fail('Target attempt requires its completed observation cutoff');
    if(r.status==='withheld'&&(a.observationCutoff!==null||a.targetInterval!==null||a.lagHours!==null||a.leadStartHours!==null||a.leadEndHours!==null))fail('Withheld information set must not invent timing intervals');
    if(a.targetInterval&&r.latestRetainedDate!==null){const origin=Date.parse(`${r.latestRetainedDate}T00:00:00Z`);if(!Number.isFinite(origin)||a.targetInterval.date!==new Date(origin+a.horizonDays*86400000).toISOString().slice(0,10))fail('Target date does not match its recorded horizon');}
    if(a.targetInterval?.startUtc&&a.targetInterval.endUtc){
      const start=micros(a.targetInterval.startUtc),end=micros(a.targetInterval.endUtc);
      if(start===null||end===null){fail('Invalid target timestamps');continue;}
      if(a.leadStartHours!==hours(start-issue)||a.leadEndHours!==hours(end-issue)||a.status==='future'&&start<=issue||a.status==='partly_elapsed'&&!(start<=issue&&issue<end)||a.status==='expired'&&issue<end)fail('Target timing does not match the issue cutoff');
    }else if(a.status!=='withheld')fail('Target interval is missing');
    const cutoff=a.observationCutoff?.endUtc?micros(a.observationCutoff.endUtc):null;
    if(cutoff!==null&&cutoff&&cutoff>issue)fail('Retained station day was incomplete at issue');
    if(cutoff!==null&&a.lagHours!==hours(issue-cutoff))fail('Observation lag does not match the issue cutoff');
  }
});
export type ForecastInformation=z.infer<typeof forecastInformationSchema>;
