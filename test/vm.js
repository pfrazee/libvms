const test = require('ava')
const tempy = require('tempy')
const {VM} = require('../')

var vm

const VM_SCRIPT = `
  exports.func1 = (v = 0) => v + 1
  exports.func2 = async () => 'bar'
  exports.writeToFile = (v) => System.files.writeFile('/file', v)
  exports.var = 'bar'
`

test('can deploy the VM', async t => {
  // initiate vm
  vm = new VM(VM_SCRIPT)
  await vm.deploy({dir: tempy.directory(), title: 'test'})
  t.truthy(vm.filesArchive, 'vm files archive created')
  t.truthy(vm.callLog, 'vm call log created')
})

test('have access to exports', async t => {
  t.deepEqual(Object.keys(vm.exports), ['func1', 'func2', 'writeToFile', 'var'])
})

test('init message is recorded to the call log', async t => {
  t.deepEqual(await vm.callLog.get(0), {
    type: 'init',
    code: VM_SCRIPT,
    filesArchiveUrl: vm.filesArchive.url
  })
})

test('calls are logged in the call log', async t => {
  // run calls
  t.is(await vm.executeCall({methodName: 'func1'}), 1, 'execute call func1()')
  t.is(await vm.executeCall({methodName: 'func1', args: [5]}), 6, 'execute call func1(5)')
  t.is(await vm.executeCall({methodName: 'func1', args: [5], userId: 'bob'}), 6, 'execute call func1(5) with user')
  t.is(await vm.executeCall({methodName: 'func2'}), 'bar', 'execute call func2()')
  t.is(await vm.executeCall({methodName: 'func2', userId: 'bob'}), 'bar', 'execute call func2() with user')

  // check call log
  t.deepEqual(await vm.callLog.get(1), {
    type: 'call',
    call: {
      methodName: 'func1',
      args: []
    },
    result: {
      filesVersion: 1,
      res: 1
    }
  })
  t.deepEqual(await vm.callLog.get(2), {
    type: 'call',
    call: {
      methodName: 'func1',
      args: [5]
    },
    result: {
      filesVersion: 1,
      res: 6
    }
  })
  t.deepEqual(await vm.callLog.get(3), {
    type: 'call',
    call: {
      methodName: 'func1',
      args: [5],
      userId: 'bob'
    },
    result: {
      filesVersion: 1,
      res: 6
    }
  })
  t.deepEqual(await vm.callLog.get(4), {
    type: 'call',
    call: {
      methodName: 'func2',
      args: []
    },
    result: {
      filesVersion: 1,
      res: 'bar'
    }
  })
  t.deepEqual(await vm.callLog.get(5), {
    type: 'call',
    call: {
      methodName: 'func2',
      args: [],
      userId: 'bob'
    },
    result: {
      filesVersion: 1,
      res: 'bar'
    }
  })
})

test('file-writes are logged in the call log', async t => {
  // run calls
  await vm.executeCall({methodName: 'writeToFile', args: ['foo']})
  await vm.executeCall({methodName: 'writeToFile', args: ['bar']})
  await vm.executeCall({methodName: 'writeToFile', args: ['baz']})

  // check call log
  t.deepEqual(await vm.callLog.get(6), {
    type: 'call',
    call: {
      methodName: 'writeToFile',
      args: ['foo']
    },
    result: {
      filesVersion: 2
    }
  })
  t.deepEqual(await vm.callLog.get(7), {
    type: 'call',
    call: {
      methodName: 'writeToFile',
      args: ['bar']
    },
    result: {
      filesVersion: 3
    }
  })
  t.deepEqual(await vm.callLog.get(8), {
    type: 'call',
    call: {
      methodName: 'writeToFile',
      args: ['baz']
    },
    result: {
      filesVersion: 4
    }
  })
})

test('can rebuild a VM from a call log', async t => {
  // initiate new vm from the call log
  const vm2 = await VM.fromCallLog(vm.callLog, {filesArchiveUrl: vm.filesArchive.url})
  t.truthy(vm2.filesArchive, 'vm2 files archive created')
  t.truthy(vm2.callLog, 'vm2 call log created')

  // final output state is ==
  await t.deepEqual(await vm2.filesArchive.readFile('/file'), 'baz', 'vm2 files are in expected state')

  // done
  await vm2.close()
})

test('checks given files url', async t => {
  await t.throws(VM.fromCallLog(vm.callLog, {filesArchiveUrl: 'wrongurl'}))
})

test('init method is called if present', async t => {
  // initiate vm
  vm = new VM(`
    var wasCalled = false
    exports.init = () => { wasCalled = true }
    exports.getWasCalled = () => wasCalled
  `)
  await vm.deploy({dir: tempy.directory(), title: 'test'})
  t.truthy(vm.filesArchive, 'vm files archive created')
  t.truthy(vm.callLog, 'vm call log created')

  // check state
  t.deepEqual(await vm.executeCall({methodName: 'getWasCalled'}), true)

  // check call log
  t.deepEqual(await vm.callLog.get(1), {
    type: 'call',
    call: {
      methodName: 'init',
      args: []
    },
    result: {
      filesVersion: 1
    }
  })
})

test('can close the VM', async t => {
  // close vm
  await vm.close()
  t.falsy(vm.filesArchive)
  t.falsy(vm.callLog)
})