import type { Candle, Depth, Ticker } from './indodax'

export type Signal = {
  type:'BUY'|'SELL'|'HOLD'|'WAIT'
  confidence:number
  entryLow:number
  entryHigh:number
  stopLoss:number
  takeProfit:number
  riskReward:number
  reasons:string[]
  quality:'validated'|'stale'|'insufficient'
  trend:'Bullish'|'Bearish'|'Neutral'
  metrics:{rsi:number;atr:number;ema20:number;ema50:number;macd:number;volumeRatio:number;spread:number}
}

type PreparedCandles = { candles:Candle[]; failure:'stale'|'insufficient'|null; reason?:string }
const REQUIRED_HISTORY = { m15:60, h1:200, h4:150 }
const INTERVAL_MS = { m15:15*60_000, h1:60*60_000, h4:240*60_000 }
const closes=(candles:Candle[])=>candles.map(candle=>candle.close)
const emptyMetrics=()=>({rsi:50,atr:0,ema20:0,ema50:0,macd:0,volumeRatio:0,spread:0})

export function ema(values:number[],period:number){
  if(values.length<period)return values[values.length-1]||0
  const k=2/(period+1)
  let value=values.slice(0,period).reduce((sum,point)=>sum+point,0)/period
  for(const point of values.slice(period))value=point*k+value*(1-k)
  return value
}

export function rsi(values:number[],period=14){
  if(values.length<=period)return 50
  let gain=0,loss=0
  for(let i=1;i<=period;i++){const change=values[i]-values[i-1];gain+=Math.max(change,0);loss+=Math.max(-change,0)}
  let avgGain=gain/period,avgLoss=loss/period
  for(let i=period+1;i<values.length;i++){const change=values[i]-values[i-1];avgGain=(avgGain*(period-1)+Math.max(change,0))/period;avgLoss=(avgLoss*(period-1)+Math.max(-change,0))/period}
  return avgLoss===0?100:100-100/(1+avgGain/avgLoss)
}

export function atr(candles:Candle[],period=14){
  if(candles.length<period+1)return 0
  const ranges=candles.slice(1).map((candle,index)=>Math.max(candle.high-candle.low,Math.abs(candle.high-candles[index].close),Math.abs(candle.low-candles[index].close)))
  return ranges.slice(-period).reduce((sum,range)=>sum+range,0)/period
}

function macd(values:number[]){return ema(values,12)-ema(values,26)}

export function liquidity(depth:Depth,ticker:Ticker){
  const spread=ticker.last>0?((ticker.sell-ticker.buy)/ticker.last)*100:Infinity
  const bid=depth.buy.slice(0,10).reduce((sum,level)=>sum+level[0]*level[1],0)
  const ask=depth.sell.slice(0,10).reduce((sum,level)=>sum+level[0]*level[1],0)
  return{spread,imbalance:(bid-ask)/(bid+ask||1)}
}

function wait(type:'stale'|'insufficient',reason:string):Signal{
  return{type:'WAIT',confidence:0,entryLow:0,entryHigh:0,stopLoss:0,takeProfit:0,riskReward:0,reasons:[reason],quality:type,trend:'Neutral',metrics:emptyMetrics()}
}

function prepareCandles(input:Candle[],interval:number,minimum:number,now:number,label:string):PreparedCandles{
  if(!Array.isArray(input))return{candles:[],failure:'insufficient',reason:`Riwayat ${label} tidak valid; sinyal dihentikan.`}
  const sorted=[...input].sort((a,b)=>a.time-b.time)
  const closed:Candle[]=[]
  for(const candle of sorted){
    if(!candle||![candle.time,candle.open,candle.high,candle.low,candle.close,candle.volume].every(Number.isFinite)||candle.time<=0){
      return{candles:[],failure:'insufficient',reason:`Candlestick ${label} mengandung nilai tidak valid; sinyal dihentikan.`}
    }
    if(candle.time>now+60_000)return{candles:[],failure:'insufficient',reason:`Timestamp candle ${label} berada di masa depan; sinyal dihentikan.`}
    if(candle.time+interval>now)continue
    if(candle.open<=0||candle.high<=0||candle.low<=0||candle.close<=0||candle.volume<0||candle.high<Math.max(candle.open,candle.close)||candle.low>Math.min(candle.open,candle.close)){
      return{candles:[],failure:'insufficient',reason:`Rentang OHLC candle ${label} tidak valid; sinyal dihentikan.`}
    }
    closed.push(candle)
  }
  for(let index=1;index<closed.length;index++){
    const gap=closed[index].time-closed[index-1].time
    if(gap<=0||gap>interval*2)return{candles:[],failure:'insufficient',reason:`Riwayat candle ${label} memiliki duplikasi atau celah; sinyal dihentikan.`}
  }
  const last=closed[closed.length-1]
  if(!last||now-(last.time+interval)>interval*2)return{candles:closed,failure:'stale',reason:`Riwayat ${label} terlalu lama; sinyal dihentikan.`}
  if(closed.length<minimum)return{candles:closed,failure:'insufficient',reason:`Riwayat ${label} belum cukup (${closed.length}/${minimum} candle tertutup).`}
  return{candles:closed,failure:null}
}

export function buildSignal(c15:Candle[],c60:Candle[],c240:Candle[],ticker:Ticker,depth:Depth):Signal{
  const now=Date.now()
  if(!ticker.sourceTime||now-ticker.sourceTime>120_000||ticker.sourceTime-now>60_000)return wait('stale','Timestamp data pasar stale atau tidak tersedia; sinyal dihentikan.')
  if(!Number.isFinite(ticker.last)||ticker.last<=0||!Number.isFinite(ticker.buy)||!Number.isFinite(ticker.sell)||!Number.isFinite(ticker.high)||!Number.isFinite(ticker.low)||ticker.buy<=0||ticker.sell<ticker.buy||ticker.low<=0||ticker.high<ticker.low||ticker.last<ticker.low||ticker.last>ticker.high){
    return wait('insufficient','Ticker tidak lengkap atau tidak valid; sinyal dihentikan.')
  }
  const frames=[
    prepareCandles(c15,INTERVAL_MS.m15,REQUIRED_HISTORY.m15,now,'15M'),
    prepareCandles(c60,INTERVAL_MS.h1,REQUIRED_HISTORY.h1,now,'1H'),
    prepareCandles(c240,INTERVAL_MS.h4,REQUIRED_HISTORY.h4,now,'4H'),
  ]
  const failure=frames.find(frame=>frame.failure)
  if(failure)return wait(failure.failure!,failure.reason||'Riwayat candle tidak cukup; sinyal dihentikan.')
  const [frame15,frame60,frame240]=frames.map(frame=>frame.candles)
  if(!depth||!Array.isArray(depth.buy)||!Array.isArray(depth.sell)||!depth.buy.length||!depth.sell.length||![...depth.buy,...depth.sell].every(([price,size])=>Number.isFinite(price)&&Number.isFinite(size)&&price>0&&size>0)){
    return wait('insufficient','Order book tidak lengkap atau tidak valid; sinyal dihentikan.')
  }
  const v15=closes(frame15),v60=closes(frame60),v240=closes(frame240)
  const e20=ema(v15,20),e50=ema(v15,50),e60=ema(v60,50),e240=ema(v240,50)
  const valueRsi=rsi(v15),valueAtr=atr(frame15),valueMacd=macd(v15)
  const priorVolume=frame15.slice(-21,-1).reduce((sum,candle)=>sum+candle.volume,0)/20||1
  const latest=frame15[frame15.length-1]!,volumeRatio=latest.volume/priorVolume,book=liquidity(depth,ticker)
  if(!Number.isFinite(book.spread)||book.spread<0)return wait('insufficient','Spread order book tidak valid; sinyal dihentikan.')
  const bull=e60>ema(v60,200)&&e240>ema(v240,150)
  const bear=e60<ema(v60,200)&&e240<ema(v240,150)
  let score=50
  const reasons:string[]=[]
  if(bull){score+=16;reasons.push('Tren 1H/4H mendukung bullish.')}
  else if(bear){score-=16;reasons.push('Tren 1H/4H cenderung bearish.')}
  else reasons.push('Tren antar-timeframe belum selaras.')
  if(e20>e50){score+=12;reasons.push('EMA 20 di atas EMA 50 pada 15M.')}
  else{score-=12;reasons.push('EMA 20 di bawah EMA 50 pada 15M.')}
  if(valueRsi>=52&&valueRsi<=70){score+=10;reasons.push(`RSI ${valueRsi.toFixed(1)} menunjukkan momentum sehat.`)}
  else if(valueRsi>78){score-=6;reasons.push(`RSI ${valueRsi.toFixed(1)} terlalu panas; hindari mengejar harga.`)}
  else if(valueRsi<35){score+=3;reasons.push(`RSI ${valueRsi.toFixed(1)} oversold; perlu konfirmasi.`)}
  if(valueMacd>0){score+=6;reasons.push('MACD berada di wilayah positif.')}
  else{score-=6;reasons.push('MACD berada di wilayah negatif.')}
  if(volumeRatio>=1.15){score+=5;reasons.push('Volume candle terakhir meningkat.')}
  if(book.spread<=0.5){score+=4;reasons.push(`Spread ${book.spread.toFixed(2)}% masih likuid.`)}
  else{score-=10;reasons.push(`Spread ${book.spread.toFixed(2)}% terlalu lebar.`)}
  score=Math.max(0,Math.min(100,Math.round(score)))
  const risk=Math.max(valueAtr*1.8,ticker.last*0.008)
  let type:'BUY'|'SELL'|'HOLD'='HOLD'
  if(score>=68&&bull&&book.spread<=0.8)type='BUY'
  else if(score<=35&&bear&&book.spread<=0.8)type='SELL'
  const isSell=type==='SELL'
  return{type,confidence:score,entryLow:Math.max(0,ticker.last-valueAtr*0.35),entryHigh:ticker.last+valueAtr*0.1,stopLoss:isSell?ticker.last+risk:ticker.last-risk,takeProfit:isSell?ticker.last-risk*2.1:ticker.last+risk*2.1,riskReward:2.1,reasons,quality:'validated',trend:bull?'Bullish':bear?'Bearish':'Neutral',metrics:{rsi:valueRsi,atr:valueAtr,ema20:e20,ema50:e50,macd:valueMacd,volumeRatio,spread:book.spread}}
}
