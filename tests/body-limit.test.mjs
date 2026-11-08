import test from 'node:test'
import assert from 'node:assert/strict'
import { readBoundedBody } from '../supabase/functions/indodax-proxy/body-limit.ts'

function streamOf(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
}

test('bounded body reader accepts content at the byte limit and decodes UTF-8', async () => {
  assert.equal(await readBoundedBody(streamOf('BTC', 'IDR'), 6), 'BTCIDR')
  assert.equal(await readBoundedBody(streamOf('é'), 2), 'é')
})

test('bounded body reader cancels and rejects content above the byte limit', async () => {
  await assert.rejects(() => readBoundedBody(streamOf('1234', '5678'), 5), RangeError)
})
