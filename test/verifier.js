const test = require('ava')
const tempy = require('tempy')
const {VM, Verifier} = require('../')

var vm
var vm2

const VM_SCRIPT = `
  exports.func1 = (v = 0) => v + 1
  exports.func2 = async () => 'bar'
  exports.writeToFile = (v) => System.files.writeFile('/file', v)
  exports.random = () => System.test.random()
`

test('can deploy the VM and run calls', async t => {
  // initiate vm
  vm = new VM(VM_SCRIPT)
  await vm.deploy({dir: tempy.directory(), title: 'test'})
  t.truthy(vm.filesArchive, 'vm files archive created')
  t.truthy(vm.callLog, 'vm call log created')

  // run calls
  t.is(await vm.executeCall({methodName: 'func1'}), 1, 'execute call func1()')
  t.is(await vm.executeCall({methodName: 'func1', args: [5]}), 6, 'execute call func1(5)')
  t.is(await vm.executeCall({methodName: 'func1', args: [5], userId: 'bob'}), 6, 'execute call func1(5) with user')
  t.is(await vm.executeCall({methodName: 'func2'}), 'bar', 'execute call func2()')
  t.is(await vm.executeCall({methodName: 'func2', userId: 'bob'}), 'bar', 'execute call func2() with user')
  await vm.executeCall({methodName: 'writeToFile', args: ['foo']})
  await vm.executeCall({methodName: 'writeToFile', args: ['bar']})
  await vm.executeCall({methodName: 'writeToFile', args: ['baz']})
})

test('can rebuild a VM from a call log', async t => {
  // initiate new vm from the call log
  vm2 = await VM.fromCallLog(vm.callLog, {filesArchiveUrl: vm.filesArchive.url})
  t.truthy(vm2.filesArchive, 'vm2 files archive created')
  t.truthy(vm2.callLog, 'vm2 call log created')

  // final output state is ==
  await t.deepEqual(await vm2.filesArchive.readFile('/file'), 'baz', 'vm2 files are in expected state')
})

test('matching logs and archives pass verification', async t => {
  // compare outputs (will throw on mismatch)
  await Verifier.compareLogs(vm.callLog, vm2.callLog)
  await Verifier.compareArchives(vm.filesArchive, vm2.filesArchive)
  t.pass()
})

test('mismatching archives fail verification', async t => {
  // change the original
  await vm.filesArchive.writeFile('/test', 'fail!')

  try {
    // compare archives (will throw on mismatch)
    await Verifier.compareArchives(vm.filesArchive, vm2.filesArchive)
    t.fail('should have failed files-archive validation')
  } catch (e) {
    t.pass()
  }
})

test('can close the VMs', async t => {
  await vm2.close()
  t.falsy(vm2.filesArchive)
  t.falsy(vm2.callLog)
  await vm.close()
  t.falsy(vm.filesArchive)
  t.falsy(vm.callLog)
})

test('nondeterministic scripts will fail verification', async t => {
  // initiate vm
  var randomVM = new VM(VM_SCRIPT)
  await randomVM.deploy({dir: tempy.directory(), title: 'test'})
  t.truthy(randomVM.filesArchive, 'randomVM files archive created')
  t.truthy(randomVM.callLog, 'randomVM call log created')

  // run calls
  await randomVM.executeCall({methodName: 'random'})
  await randomVM.executeCall({methodName: 'random'})
  await randomVM.executeCall({methodName: 'random'})

  // replay
  var randomVM2 = await VM.fromCallLog(randomVM.callLog, {filesArchiveUrl: randomVM.filesArchive.url})

  // compare logs (will throw on mismatch)
  await t.throws(Verifier.compareLogs(randomVM.callLog, randomVM2.callLog))
})