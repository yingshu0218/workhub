import { expect, it } from 'vitest'
import { financeTotals, minorUnits } from '../core'
it('金额转换拒绝超精度，按 ID 去重并分币种汇总',()=>{
  expect(minorUnits(0.29)).toBe(29)
  expect(()=>minorUnits(1.001)).toThrow('MONEY_PRECISION')
  const r={id:'a',currency:'CNY',amountMinor:10000,type:'income'}
  expect(financeTotals([r,r,{...r,id:'b',currency:'USD'}])).toEqual({CNY:{incomeMinor:10000,expenseMinor:0,count:1},USD:{incomeMinor:10000,expenseMinor:0,count:1}})
})
