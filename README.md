# LibVMS (alpha, v2.0.0)

An API for running cryptographically auditable VM services. Part of [NodeVMS](https://npm.im/nodevms).

## Overview

LibVMS is a VM hosting toolset built on NodeJS. Its goal is to let users provision servers on untrusted hardware, therefore increasing the amount of computing power which can shared between acquaintances and social groups.

To accomplish this, LibVMS uses [an append-only ledger](https://npm.im/hypercore) to maintain a call log. The call log records the VM script, all RPC calls, and all call results. The log is then distributed on the [Dat network](https://beakerbrowser.com/docs/inside-beaker/dat-files-protocol.html); it can not be forged, and it can not be altered after distribution (alterations are trivial to detect).

For each VM, LibVMS provisions a [Dat files archive](https://npm.im/hyperdrive) to store state. The archive is distributed over the Dat network for clients to read. As with the call log, the files archive is backed by an append-only ledger.

### Auditing

The security of LibVMS rests in the unforgeability of its ledgers, and the ability to fully replay the VM history.

Any client can download the call log and files archive, instantiate their own copy of the VM, and replay the log to verify the results. If a replay is found to produce mismatched state, we can assume either A) the VM script has nondeterministic behaviors, or B) the host has tampered with the state of the VM. In either case, the VM is no longer trustworthy.

### Authentication

LibVMS has a concept of users and user ids. In debug mode, the user ids are plain authenticated strings. In production mode, the user ids are authenticated public keys and all calls are signed.

Currently, only debug mode authentication is implemented.

### VM environment

LibVMS exposes a set of APIs to the VMs using the global `System` object. Currently, it is a fixed API ([see docs](./docs/vm-api.md)). In the future it will be customizable.

## Docs

 - [API documentation](./docs/api.md)
 - [VM API documentation](./docs/vm-api.md)

## Examples

### Run a VM

```js
const {VM, RPCServer} = require('libvms')

// the script
const scriptCode = `
  exports.foo = () => 'bar'
`
const dir = './bobs-vm-data'
const title = 'Bobs VM'

// initiate vm
const vm = new VM(scriptCode)
await vm.deploy({dir, title})
console.log('vm api exports:', Object.keys(vm.exports))

// init rpc server
var rpcServer = new RPCServer()
rpcServer.mount('/bobs-vm', vm)
await rpcServer.listen(5555)
console.log('Serving at localhost:5555')
console.log('Files URL:', vm.filesArchive.url)
console.log('Call log URL:', vm.callLog.url)
```

### Connect to run commands

```js
const {RPCClient} = require('libvms')

// connect to the server
const client = new RPCClient()
await client.connect('ws://localhost:5555/bobs-vm')

// run the command
console.log(await client.foo()) // => 'bar'
```

### Audit the VM state

```js
const {RPCClient, CallLog, DatArchive, VM} = require('libvms')

// connect to the server
const client = new RPCClient()
await client.connect('ws://localhost:5555/bobs-vm')

// fetch the call log
const callLog = await CallLog.fetch(client.backendInfo.callLogUrl)

// fetch the dat archive
const filesArchive = new DatArchive(client.backendInfo.filesArchiveUrl)
await filesArchive.download('/')

// replay the call log
const vm = await VM.fromCallLog(callLog, client.backendInfo, {dir: opts.dir})

// compare outputs (will throw on mismatch)
await Verifier.compareLogs(callLog, vm.callLog)
await Verifier.compareArchives(filesArchive, vm.filesArchive)
```

### Run a VM factory

A VM factory is an endpoint which provisions other VMs via RPC.

```js
const ms = require('ms')
const {VMFactory} = require('libvms')

// load the factory script
const factoryScript = /* see below */

// initialize a VM factory
const dir = './vm-factory'
const title = 'Bobs VM Host'
const vmFactory = new VMFactory(factoryScript)
await vmFactory.deploy({dir, title})

// init rpc server, with the factory at root
var rpcServer = new RPCServer()
rpcServer.mount('/', vmFactory)
vmFactory.setRPCServer(rpcServer)
await rpcServer.listen(5555)
console.log('Serving at localhost:5555')
console.log('Files URL:', vmFactory.filesArchive.url)
console.log('Call log URL:', vmFactory.callLog.url)
```

You have to provide the logic for VM provision. It is *required* to export two methods: `provisionVM` and `shutdownVM`. It also has access to the special `System.vms` API.

Here is a simple example factory script:

```js
exports.init = async () => {
  await System.files.mkdir('/vms')
}

// vm api

exports.provisionVM = async (args) => {
  const vm = await System.vms.provisionVM(args)
  await writeRecord(vm.id, {vm, args, owner: System.caller.id})
  return vm
}

exports.shutdownVM = async (id) => {
  const record = await readRecord(id)
  await assertVMPermission(record)
  await System.vms.shutdownVM(id)
  await deleteRecord(id)
}

// record helpers

async function writeRecord (id, record) {
  await System.files.writeFile('/vms/' + id + '.json', JSON.stringify(record))
}

async function deleteRecord (id) {
  await System.files.unlink('/vms/' + id + '.json')
}

async function readRecord (id) {
  try {
    return JSON.parse(await System.files.readFile('/vms/' + id + '.json'))
  } catch (e) {
    throw new Error('VM record not found')
  }
}

// asserts

async function assertVMPermission (record) {
  const callerId = System.caller.id
  if (callerId !== record.owner) {
    throw new Error('You are not authorized to shut down this vm')
  }
}
```


### Provision a VM from a factory as a client

```js
const ms = require('ms')
const {RPCClient} = require('libvms')

// connect to the server
const client = new RPCClient()
await client.connect('ws://localhost:5555/')

// provision the VM
var vmInfo = await client.provisionVM({
  code: `exports.foo = () => 'bar'`,
  title: 'Bobs Provisioned VM'
})

// connect to the VM to run a command
const client2 = new RPCClient()
await client2.connect(vmInfo.rpcUrl)
console.log(await client.foo()) // => 'bar'

// audit the VM
const callLog = await CallLog.fetch(vmInfo.callLogUrl)
const filesArchive = new DatArchive(vmInfo.filesArchiveUrl)
await filesArchive.download('/')
const vm = await VM.fromCallLog(callLog, vmInfo)
await Verifier.compareLogs(callLog, vm.callLog)
await Verifier.compareArchives(filesArchive, vm.filesArchive)
```