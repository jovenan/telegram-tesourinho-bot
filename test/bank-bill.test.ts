import { expect, test } from 'bun:test'
import { bestPurchaseDay, billFor, targetMonth } from '../src/bank/bill'

const C6 = { dueDay: 5, closingDaysBeforeDue: 7 }
const day = (text: string) => {
  const [d, m, y] = text.split('/').map(Number)
  return { year: y, month: m, day: d }
}
const tab = (purchase: string) => targetMonth(day(purchase), C6)

test('purchases go to the month the bill is due (examples from the plan)', () => {
  expect(tab('03/10/2026')).toEqual({ month: '11/2026', fromBank: false })
  expect(tab('15/10/2026')).toEqual({ month: '11/2026', fromBank: false })
  expect(tab('30/10/2026')).toEqual({ month: '12/2026', fromBank: false })
  expect(tab('28/02/2027')).toEqual({ month: '04/2027', fromBank: false })
})

test('the closing day may fall on either bill', () => {
  expect(tab('29/10/2026')).toEqual({ month: '11/2026', alternative: '12/2026', fromBank: false })
})

test('closing and best purchase day per due date', () => {
  for (const [purchase, closing, best] of [
    ['20/10/2026', '29/10/2026', '30/10/2026'],
    ['20/11/2026', '28/11/2026', '29/11/2026'],
    ['20/12/2026', '29/12/2026', '30/12/2026'],
    ['20/02/2027', '26/02/2027', '27/02/2027']
  ]) {
    const bill = billFor(day(purchase), C6)
    expect(bill.closing).toEqual(day(closing))
    expect(bestPurchaseDay(bill)).toEqual(day(best))
  }
})

test('the year rolls over', () => {
  expect(tab('31/12/2026')).toEqual({ month: '02/2027', fromBank: false })
  expect(tab('15/12/2026')).toEqual({ month: '01/2027', fromBank: false })
})

test('due days past the end of the month are clamped', () => {
  expect(billFor(day('10/02/2027'), { dueDay: 31, closingDaysBeforeDue: 7 }).due).toEqual(day('28/02/2027'))
})

test("the bank's bill wins over the rule", () => {
  expect(targetMonth(day('30/10/2026'), C6, day('05/11/2026'))).toEqual({ month: '11/2026', fromBank: true })
})
