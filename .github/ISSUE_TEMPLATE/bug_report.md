---
name: Bug report
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''
---

**Describe the bug**

<!-- A clear and concise description of what the bug is. -->

**Related hardware**

<!-- If applicable, indicate the device(s) official product name (eg. TYXIA 5610). -->

**Expected behavior**

<!-- A clear and concise description of what you expected to happen. -->

**Logs**

<!-- If applicable, add logs to help explain your problem.
     Make sure that you are running with debug enabled using the following env var: `DEBUG=homebridge-tydom`. -->

**Dumps**

<!--
To help speed up your issue, please provide a dump of your tydom configuration using node-tydom-client
```sh
npx tydom-client request /configs/file /devices/data /devices/meta /devices/cmeta --file tydom_output.json --username 001A25XXXXXX --password XXXXXX
```
Will create the file `tydom_output.json` to upload, you can use https://gist.github.com

An homebridge log with [debug enabled](https://github.com/mgcrea/homebridge-tydom#debug) while using the tydom official app (to trace working requests) can also help a lot.
-->

**Versions**

<!-- Please make sure you are using the latest available version published on npm. -->

- homebridge-tydom: `v0.x.x`

**Additional context**

<!-- Add any other context about the problem here. -->
