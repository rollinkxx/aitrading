import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSignal } from '../src/lib/strategy.ts'

function candles(direction,count=220){
 return Array.from({length:count},(_,i)=>{const close=direction==='up'?100+i:320-i;const open=direction==='up'?close-0.5:close+0.5;return{time:Date.now()-(count-i)*900_000,open,high:Math.max(open,close)+1,low:Math.min(open,close)-1,close,volume:i===count-1?200:100}})
}
const depth={buy:Array.from({length:10},(_,i)=>[100-i*0.01,20]),sell:Array.from({length:10},(_,i)=>[102+i*0.01,20])}
function ticker(last,sourceTime=Date.now()){return{last,buy:last-0.1,sell:last+0.1,high:last+10,low:last-10,volume:1_000,sourceTime}}

test('stale timestamps fail closed to WAIT',()=>{
 const signal=buildSignal(candles('up'),candles('up'),candles('up'),ticker(319,Date.now()-180_000),depth)
 assert.equal(signal.type,'WAIT')
 assert.equal(signal.quality,'stale')
})

test('invalid order book fails closed to WAIT',()=>{
 const signal=buildSignal(candles('up'),candles('up'),candles('up'),ticker(319),{buy:[],sell:[]})
 assert.equal(signal.type,'WAIT')
 assert.equal(signal.quality,'insufficient')
})

test('bearish SELL has stop above and target below reference price',()=>{
 const signal=buildSignal(candles('down'),candles('down'),candles('down'),ticker(101),depth)
 assert.equal(signal.type,'SELL')
 assert.ok(signal.stopLoss>101)
 assert.ok(signal.takeProfit<101)
})
