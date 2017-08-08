# LibVMS

An API for running cryptographically auditable VM services. Part of [NodeVMS](https://npm.im/nodevms).

## How it works

LibVMS uses the Node VM to execute Javascript files. Its goal is to enable low-trust execution of VMs through auditing.

To accomplish this, LibVMS uses [an append-only ledger](https://npm.im/hypercore) to maintain a call log. The call log records the VM script, all RPC calls, and all call results. The log is then distributed on the [Dat network](https://beakerbrowser.com/docs/inside-beaker/dat-files-protocol.html); it can not be forged, and it can not be altered after distribution (alterations are trivial to detect).

For each VM, LibVMS provisions a [Dat files archive](https://npm.im/hyperdrive) to store state. The archive is distributed over the Dat network for clients to read. As with the call log, the files archive is backed by an append-only ledger.

### Auditing

The security of LibVMS rests in the unforgeability of its ledgers, and the ability to fully replay the VM history. Any client can download the call log and files archive, instantiate their own copy of the VM, and replay the log to verify the results. If a replay is found to produce mismatched state, we can assume either A) the VM script has nondeterministic behaviors, or B) the host has tampered with the state of the VM. In either case, the VM is no longer trustworthy.

### Authentication

LibVMS has a concept of users and user ids. In debug mode, the user ids are plain authenticated strings. In production mode, the user ids are authenticated public keys and all calls are signed.

Currently, only debug mode authentication is implemented.

**This is beta software** and subject to changes.

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

### Run a VM provider

```js
const ms = require('ms')
const {VMFactory} = require('libvms')

// initialize a VM factory
const dir = './vm-factory'
const title = 'Bobs VM Host'
const vmFactory = new VMFactory()
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

### Provision a VM from a host as a client

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

## API

```js
const {
  VM,
  VMFactory,
  CallLog,
  DatArchive,
  Verifier,
  RPCServer,
  RPCClient
} = require('libvms')
```

### VM

```js
const {VM} = require('libvms')

// step 1. instantiate vm with a script
var vm = new VM(`exports.foo = () => 'bar'`)

// step 2. start the files archive & call log, and eval the script
await vm.deploy({
  dir: './foo-vm-data',
  title: 'The Foo Backend'
})

// step 3. start the RPC server
const {RPCServer} = require('libvms')
var server = new RPCServer()
server.mount('/foo', vm)
await server.listen({port: 5555})

// now serving!

// attributes:
vm.code // vm script contents
vm.exports // the `module.exports` of the vm script
vm.filesArchive // the vm's DatArchive
vm.callLog // the vm's CallLog

// events
vm.on('ready')
vm.on('close')

// methods
await vm.executeCall({methodName, args, userId})
await vm.close()

// alternative instantiation: replaying a call log
var vm = VM.fromCallLog(callLog, assertions)
// ^ assertions are values in the call log that need to be tested, currently:
//   - filesArchiveUrl: the url expected for the files archive
```

### VMFactory

The `VMFactory` is a subtype of the `VM`, designed to mount other VMs.

```js
const {VMFactory} = require('libvms')

// step 1. instantiate vmfactory
var vmFactory = new VMFactory({maxVMs: 100})

// step 2. start the factory's files archive & call log
await vmFactory.deploy({
  dir: './vms',
  title: 'The Foo VM Host'
})

// step 3. start the RPC server
const {RPCServer} = require('libvms')
var server = new RPCServer()
server.mount('/', vmFactory)
vmFactory.setRPCServer(rpcServer)
await server.listen({port: 5555})

// now serving!

// attributes:
vmFactory.code // vm script contents
vmFactory.exports // the `module.exports` of the vm script
vmFactory.filesArchive // the vm's DatArchive
vmFactory.callLog // the vm's CallLog

// methods:
await vmFactory.provisionVM({code, title})
await vmFactory.shutdownVM(id)
await vmFactory.reprovisionSavedVMs() // call after a process restart to resume existing VMs
await vmFactory.close()
```

### CallLog

```js
const {CallLog} = require('libvms')

// create, open, or fetch the log
var callLog = CallLog.create(dir, code, filesArchiveUrl)
var callLog = CallLog.open(dir)
var callLog = CallLog.fetch(callLogUrl, dir) // if `dir` is falsy, will use memory

// methods/attrs:
callLog.length // how many entries in the log
await callLog.list({start, end}) // list the entries. start/end optional

// appends (used internally):
await callLog.append(obj)
await callLog.appendInit({code, filesArchiveUrl})
await callLog.appendCall({userId, methodName, args, res, err, filesVersion})
```

### DatArchive

See [node-dat-archive](https://npm.im/node-dat-archive)

### Verifier

```js
const {Verifier} = require('libvms')

await Verifier.compareLogs(callLogA, callLogB)
await Verifier.compareArchives(archiveA, archiveB)
```

### RPCServer

```js
const {RPCServer} = require('libvms')

var server = new RPCServer()
server.mount(path, vm)
server.unmount(path)
await server.listen({port:})
server.close()
```

### RPCClient

```js
const {RPCClient} = require('libvms')

const client = new RPCClient()
await client.connect(url, {user:}) // 'user' is optional

client.url // => string
client.backendInfo.methods // => Array of strings, the method names
client.backendInfo.callLogUrl // => url of the vm's call log
client.backendInfo.filesArchiveUrl // => url of the vm's files archive

// all methods exported by the vm will be attached to `client`
await client.foo() // => 'bar'
client.close()
```