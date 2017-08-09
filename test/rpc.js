const test = require('ava')
const tempy = require('tempy')
const {VM, RPCServer, RPCClient} = require('../')

var vm
var rpcServer
var rpcClient

const VM_SCRIPT = `
  exports.func1 = (v = 0) => v + 1
  exports.func2 = async () => 'bar'
  exports.writeToFile = (v) => System.files.writeFile('/file', v)
  exports.writeCallerToFile = () => exports.writeToFile(System.caller.id)

  // this is used to prove that races dont occur
  // the wait *decreases* with each invocation
  // the script-wide lock stops that from changing the write order
  var waitTime = 250
  exports.waitThenWriteToFile = async (v) => {
    await new Promise(resolve => setTimeout(resolve, waitTime))
    waitTime -= 50
    await System.files.writeFile('/file', ''+v)
  }

  exports.var = 'bar'
`

test('can deploy the VM & RPC server', async t => {
  // initiate vm
  vm = new VM(VM_SCRIPT)
  await vm.deploy({dir: tempy.directory(), title: 'test'})
  t.truthy(vm.filesArchive, 'vm files archive created')
  t.truthy(vm.callLog, 'vm call log created')

  // initiate RPC server
  rpcServer = new RPCServer()
  rpcServer.mount('/vm1', vm)
  await rpcServer.listen(5555)
})

test('can connect and make calls', async t => {
  // connect
  rpcClient = new RPCClient()
  await rpcClient.connect('ws://localhost:5555/vm1')
  t.deepEqual(rpcClient.backendInfo.methods, ['func1', 'func2', 'writeToFile', 'writeCallerToFile', 'waitThenWriteToFile'])

  // make calls
  t.deepEqual(await rpcClient.func1(), 1, 'rpc client func1()')
  t.deepEqual(await rpcClient.func1(5), 6, 'rpc client func1(5)')
  t.deepEqual(await rpcClient.func2(), 'bar', 'rpc client func2()')
  t.deepEqual(await rpcClient.writeToFile('foo'), undefined, 'rpc client writeToFile("foo")')
})

test('calls do not race', async t => {
  // make calls
  for (let i = 1; i <= 5; i++) {
    await rpcClient.waitThenWriteToFile(i)
  }

  // test final value
  t.deepEqual(await vm.filesArchive.readFile('/file'), '5', 'calls do not race')
})

test('can handle calls from multiple clients', async t => {
  // add 2 more connections
  var rpcClient2 = new RPCClient()
  await rpcClient2.connect('ws://localhost:5555/vm1', {user: 'alice'})
  var rpcClient3 = new RPCClient()
  await rpcClient3.connect('ws://localhost:5555/vm1', {user: 'bob'})

  // make calls
  await rpcClient.writeCallerToFile()
  await rpcClient2.writeCallerToFile()
  await rpcClient3.writeCallerToFile()

  // test final value
  t.deepEqual(await vm.filesArchive.readFile('/file'), 'bob', 'multiple clients do not race')

  // close the extra connections
  await rpcClient2.close()
  await rpcClient3.close()
})

test('init method is not exposed over RPC', async t => {
  // open a websocket
  const WebSocketClient = require('rpc-websockets').Client
  const wsClient = new WebSocketClient('ws://localhost:5555')

  // wait for the socket to open
  await new Promise((resolve, reject) => {
    wsClient.on('open', resolve)
    wsClient.on('error', reject)
  })

  // try to call init
  try {
    await wsClient.call('init')
    t.fail('init() did not fail')
  } catch (e) {
    t.deepEqual(e, {code: -32601, message: 'Method not found'})
  }

  wsClient.close()
})

test('can close the client, server, and vm', async t => {
  await rpcClient.close()
  await rpcServer.close()
  await vm.close()
  t.pass()
})