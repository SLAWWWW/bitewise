import {describe,expect,it} from 'vitest';
import {receiptBody} from '@/src/contracts/direct';

const base={expected_revision:1,accepted_quantity:'10',rejected_quantity:'0',inspection:{smell:'PASS',appearance:'PASS',texture:'PASS',packaging:'PASS',taste:'NOT_PERFORMED'}} as const;

describe('recipient receipt inspection contract',()=>{
  it('accepts a complete no-concern inspection',()=>{
    expect(receiptBody.safeParse(base).success).toBe(true);
  });

  it('requires rejected quantity and observations when any check raises a concern',()=>{
    const invalid=receiptBody.safeParse({...base,inspection:{...base.inspection,smell:'CONCERN'}});
    expect(invalid.success).toBe(false);
    const valid=receiptBody.safeParse({...base,accepted_quantity:'7',rejected_quantity:'3',inspection:{...base.inspection,smell:'CONCERN',notes:'Unexpected sour smell on three portions'}});
    expect(valid.success).toBe(true);
  });
});
