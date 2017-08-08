const assert = require('assert')
const path = require('path')
const VM = require('./vm')

// VM factory
// =

class VMFactory extends VM {
  constructor ({maxVMs}) {
    super(FACTORY_SCRIPT)
    this.maxVMs = maxVMs
    this.rpcServer = null
    this.addAPI('vmFactory', {
      provisionVM: opts => this.provisionVM(opts),
      shutdownVM: id => this.shutdownVM(id)
    })
  }

  setRPCServer (s) {
    this.rpcServer = s
  }

  async provisionVM ({code, title}) {
    if (this.maxVMs) {
      assert(this.numVMs < this.maxVMs, 'This host is at maximum capacity')
    }
    assert(code && typeof code === 'string', 'Code is required')

    // initiate vm
    const vm = new VM(code)
    const dir = path.join(this.dir, vm.id)
    await vm.deploy({dir, title})
    this.numVMs++
    this.VMs[vm.id] = vm
    vm.on('close', () => {
      this.numVMs--
      delete this.VMs[vm.id]
    })

    // mount to the server
    this.rpcServer.mount('/' + vm.id, this)

    return {
      id: vm.id,
      callLogUrl: vm.callLog.url,
      filesArchiveUrl: vm.filesArchive.url
    }
  }

  async shutdownVM (id) {
    // unmount from the server
    this.rpcServer.closeNamespace('/' + id)

    // close the VM
    await this.VMs[id].close()
  }

  async reprovisionSavedVMs () {
    const vmFileNames = await this.filesArchive.readdir('/vms')
    await vmFileNames.map(async (vmFileName) => {
      const data = JSON.parse(await this.filesArchive.readFile('/vms/' + vmFileName))
      await this.provisionVM(data.args)
    })
  }

  getVM (id) {
    return this.VMs[id]
  }
}

// factory api script
// =
const FACTORY_SCRIPT = `
  exports.init = async () => {
    await System.files.mkdir('/vms')
  }

  // settings api

  exports.addAdmin = async (id) => {
    var settings = await readSettings()
    if (settings.admins.indexOf(id) === -1) {
      settings.admins.push(id)
      await writeSettings(settings)
      return true
    }
    return false
  }

  exports.removeAdmin = async (id) => {
    var settings = await readSettings()
    var i = settings.admins.indexOf(id)
    if (i !== -1) {
      settings.admins.splice(i, 1)
      await writeSettings(settings)
      return true
    }
    return false
  }

  // vm api

  exports.provisionVM = async (args) => {
    const vm = await System.vmFactory.provisionVM(args)
    await writeRecord(vm.id, {vm, args, owner: System.caller.id})
    return vm
  }

  exports.shutdownVM = async (id) => {
    const record = await readRecord(id)
    await assertPermission(record)
    await System.vmFactory.shutdownVM(id)
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

  // settings helper

  var settingsCached

  async function writeSettings (settings) {
    settingsCached = settings
    await System.files.writeFile('/settings.json', JSON.stringify(settings))
  }

  async function readSettings () {
    if (settingsCached) return settingsCached
    var settings
    try {
      settings = await System.files.readFile('/settings.json')
    } catch (e) {
      settings = {
        admins: []
      }
    }
    settingsCached = settings
    return settings
  }

  // various

  async function assertPermission (record) {
    const settings = await readSettings()
    const callerId = System.caller.id
    if (callerId !== record.owner && settings.admins.indexOf(callerId) === -1) {
      throw new Error('You are not authorized to shut down this vm')
    }
  }
`

module.exports = VMFactory
