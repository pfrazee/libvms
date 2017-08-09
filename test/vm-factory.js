const test = require('ava')
const tempy = require('tempy')
const {VMFactory, RPCServer, RPCClient} = require('../')

var vmFactory
var rpcServer
var factoryClient
var vmInfo

const VM_FACTORY_SCRIPT = `
  exports.provisionVM = (args) => System.vms.provisionVM(args)
  exports.shutdownVM = (id) => System.vms.shutdownVM(id)
`

const VM_SCRIPT = `
  exports.hello = () => 'world'
`

test('can deploy the VM factory & RPC server', async t => {
  // initiate vm
  vmFactory = new VMFactory(VM_FACTORY_SCRIPT)
  await vmFactory.deploy({dir: tempy.directory(), title: 'test'})
  t.truthy(vmFactory.filesArchive, 'vmFactory files archive created')
  t.truthy(vmFactory.callLog, 'vmFactory call log created')

  // init rpc server, with the factory at root
  rpcServer = new RPCServer()
  rpcServer.mount('/foo', vmFactory)
  vmFactory.setRPCServer(rpcServer)
  await rpcServer.listen(5555)
})

test('can connect and provision a VM', async t => {
  // connect
  factoryClient = new RPCClient()
  await factoryClient.connect('ws://localhost:5555/foo')
  t.deepEqual(factoryClient.backendInfo.methods, ['provisionVM', 'shutdownVM'])

  // provision
  vmInfo = await factoryClient.provisionVM({title: 'foo', code: VM_SCRIPT})
  var vm = vmFactory.VMs[Object.keys(vmFactory.VMs)[0]]
  t.deepEqual(vmInfo, {
    id: vm.id,
    filesArchiveUrl: vm.filesArchive.url,
    callLogUrl: vm.callLog.url
  })
})

test('can connect to the provisioned VM and run calls', async t => {
  // connect
  const vmClient = new RPCClient()
  await vmClient.connect('ws://localhost:5555/' + vmInfo.id)
  t.deepEqual(vmClient.backendInfo.methods, ['hello'])

  // run calls
  t.deepEqual(await vmClient.hello(), 'world', 'can call to the provisioned vm')

  await vmClient.close()
})

test('can close the client, server, and vm', async t => {
  await factoryClient.close()
  await rpcServer.close()
  await vmFactory.close()
  t.pass()
})