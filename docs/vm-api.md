# VM API

This is the API provided to VMs for their execution.

```js
const fs = System.files
```

## System.caller.id

The id of the calling user. VM scripts should assume this value is authenticated (and trustworthy).

## System.files

This is a subset of the [DatArchive](https://beakerbrowser.com/docs/apis/dat.html) API. It provides access to the VM's files archive.

```js
await System.files.getInfo()
await System.files.stat(path)
await System.files.readFile(path, opts)
await System.files.readdir(path, opts)
await System.files.writeFile(path, data, opts)
await System.files.mkdir(path)
await System.files.unlink(path)
await System.files.rmdir(path, opts)
await System.files.history(opts)
```

## System.vms

This is a special API which is only available to VM factory scripts.

```js
await System.vms.provisionVM({title, code})
await System.vms.shutdownVM(id)
```