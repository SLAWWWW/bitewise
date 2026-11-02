import { afterEach, describe, expect, it, vi } from 'vitest';
import { planAllocation, rankCandidate, weightedScore, type Candidate, type FeatureSnapshot } from '@/src/domain/allocation/planner';
import { sendMock } from '@/src/adapters/messaging/mock';
import { donationBody } from '@/src/contracts/direct';

const weights={N:0.35,F:0.25,L:0.2,R:0.1,E:0.1};
const candidate=(patch:Partial<Candidate>={}):Candidate=>({
  id:'f1',code:'FLO-0001',name:'Demo',reasons:[],travel:{minutes:10,distance_km:2,source:'FIXTURE'},same_cluster:true,capacity:'60',
  need:{score:90,assessed_at:'2026-10-25T01:00:00Z',expires_at:'2026-11-01T01:00:00Z'},
  schedules:[{id:'s1',effective_from:'2026-01-01',effective_to_excl:null,service_dows:[1,2,3,4,5,6,7],people_per_event:100,count_basis:'DAILY_RESIDENTS'}],
  demands:[{id:'d1',unit:'portion',basis:'PER_EVENT_QTY',quantity:'100',valid_from:'2026-01-01',valid_to_excl:null,status:'CONFIRMED'}],closures:[],
  received:'0',received_7:'0',received_30:'0',committed:'0',last_received:null,responses:{opportunities:0,timely:0},reporting:[],...patch,
});
const snapshot=(candidates:Candidate[]):FeatureSnapshot=>({
  item_id:'i1',item_revision:1,policy_id:'p1',policy:{weights,max_travel_minutes:{BREAD:60},min_useful_qty:{BREAD:{qty:'10',unit:'portion'}},wave_size:3},
  now:'2026-10-26T01:00:00Z',timezone:'Asia/Jakarta',planning_date:'2026-10-26',service_date:'2026-10-26',from_date:'2026-09-27',to_date_excl:'2026-10-27',
  horizon_start:'2026-09-26T17:00:00Z',horizon_end:'2026-10-26T17:00:00Z',receipt_at:'2026-10-26T02:00:00Z',distribution_at:'2026-10-26T03:00:00Z',
  quantity:'120',available:'120',unit:'portion',category:'BREAD',increment:'1',candidates,
});
describe('deterministic allocation engine',()=>{
  it.each([
    [{N:.8,F:.3,L:.9,R:.8,E:.9},70.5],
    [{N:.9,F:.8,L:.7,R:.7,E:.6},78.5],
    [{N:.7,F:.9,L:.8,R:.5,E:.5},73],
  ] as const)('matches the PRD worked score %j', (f,score)=>expect(weightedScore(f,weights)).toBeCloseTo(score,10));
  it('rejects invalid weights and factors',()=>{
    expect(()=>weightedScore({N:2,F:0,L:0,R:0,E:0},weights)).toThrow(RangeError);
    expect(()=>weightedScore({N:1,F:1,L:1,R:1,E:1},{...weights,N:.4})).toThrow(RangeError);
  });
  it('never ranks an expired agreement despite high need',()=>{
    const c=candidate({reasons:['AGREEMENT_EXPIRED']});const plan=planAllocation(snapshot([c]));
    expect(plan.selected).toHaveLength(0);expect(plan.excluded[0].reasons).toContain('AGREEMENT_EXPIRED');expect(plan.unallocated_quantity).toBe('120');
  });
  it('keeps unknown need, history and performance neutral with sample counts',()=>{
    const c=candidate({need:null,demands:[]});const row=rankCandidate(c,snapshot([c]));
    expect(row.factors.N).toBe(.5);expect(row.factors.R).toBe(.5);expect(row.factors.E).toBe(.5);
    expect(row.response_samples).toBe(0);expect(row.reporting_samples).toBe(0);expect(row.coverage).toBeNull();expect(row.flags).toContain('DEMAND_UNKNOWN');
  });
  it('does not use organisation names or type as score inputs',()=>{
    const a=candidate({name:'Panti Demo'});const b=candidate({name:'Non Panti Demo'});
    expect(rankCandidate(a,snapshot([a])).score).toBe(rankCandidate(b,snapshot([b])).score);
  });
  it('receipts replacing an incoming commitment preserve projected coverage',()=>{
    const a=candidate({received:'10',committed:'50',last_received:'2026-10-25T01:00:00Z'});
    const b=candidate({received:'60',committed:'0',last_received:'2026-10-25T01:00:00Z'});
    expect(rankCandidate(a,snapshot([a])).coverage).toBe(rankCandidate(b,snapshot([b])).coverage);
  });
  it('computes coverage from documented demand rather than headcount totals',()=>{
    const a=candidate({received:'300',demands:[{...candidate().demands[0],quantity:'20'}]});
    const b=candidate({received:'300',demands:[{...candidate().demands[0],quantity:'200'}]});
    expect(rankCandidate(a,snapshot([a])).coverage).toBe(.5);expect(rankCandidate(b,snapshot([b])).coverage).toBe(.05);
  });
  it('extends demand and commitments to the same future service date',()=>{
    const c=candidate({received:'300',committed:'100'});const s=snapshot([c]);s.to_date_excl='2026-10-28';s.service_date='2026-10-27';
    expect(rankCandidate(c,s).coverage).toBeCloseTo(400/3100);
  });
  it('uses exact increments, bounded waves, deterministic ties and visible remainder',()=>{
    const candidates=[candidate({id:'2',code:'FLO-0002',capacity:'40'}),candidate({id:'1',capacity:'60'})];
    const p=planAllocation(snapshot(candidates));
    expect(p.selected.map(c=>[c.code,c.quantity])).toEqual([['FLO-0001','60'],['FLO-0002','40']]);expect(p.unallocated_quantity).toBe('20');
    const s=snapshot([candidate({capacity:'100.5'})]);s.increment='0.5';s.available='11.251';expect(planAllocation(s).selected[0].quantity).toBe('11');expect(planAllocation(s).unallocated_quantity).toBe('0.251');
  });
  it('excludes pending review from reporting; late accepted evidence scores half',()=>{
    const base=candidate();const s=snapshot([base]);
    const review={type:'BAST' as const,state:'UNDER_REVIEW',due_at:'2026-10-25T01:00:00Z',timeliness:null};
    expect(rankCandidate(candidate({reporting:[review]}),s).factors.E).toBe(.5);
    const late=rankCandidate(candidate({reporting:[{...review,state:'ACCEPTED',timeliness:'LATE'}]}),s);
    expect(late.reporting_samples).toBe(1);expect(late.factors.E).toBe(.5);
    expect(rankCandidate(candidate({reporting:[{...review,state:'ACCEPTED',timeliness:'ON_TIME'}]}),s).factors.E).toBeGreaterThan(late.factors.E);
  });
});
describe('simulation side effect boundary',()=>{
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
  it('never invokes fetch even with real-looking credentials configured',async()=>{
    vi.stubEnv('FONNTE_TOKEN','synthetic-provider-token');const network=vi.fn();vi.stubGlobal('fetch',network);
    const result=await sendMock({id:'msg1',mode:'DEMO',payload:{offer_id:'o1',contact_id:'c1',text:'Offer'},fault:null});
    expect(result.state).toBe('DELIVERED');
    expect(network).not.toHaveBeenCalled();
  });
  it('refuses LIVE and preserves ambiguous outcomes',async()=>{
    const message={id:'msg1',mode:'LIVE' as const,payload:{offer_id:'o1',contact_id:'c1',text:'Offer'},fault:null};
    await expect(sendMock(message)).rejects.toThrow('LIVE_SEND_BLOCKED');
    expect((await sendMock({...message,mode:'TEST',fault:'TIMEOUT'})).state).toBe('DELIVERY_UNKNOWN');
  });
  it('rejects a reversed pickup interval even with different UTC offsets',()=>{
    expect(donationBody.safeParse({donor_id:'00000000-0000-4000-8000-000000000001',source_location_id:'00000000-0000-4000-8000-000000000001',
      pickup_start:'2026-10-26T10:00:00+07:00',pickup_end:'2026-10-26T10:30:00+08:00',donation_reason:'SURPLUS',items:[]}).success).toBe(false);
  });
});
