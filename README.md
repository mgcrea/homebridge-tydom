# Homebridge Tydom Plugin

[![npm version](https://img.shields.io/npm/v/homebridge-tydom.svg)](https://github.com/mgcrea/homebridge-tydom/releases)
[![license](https://img.shields.io/github/license/mgcrea/homebridge-tydom.svg?style=flat)](https://tldrlegal.com/license/mit-license)
[![build status](https://travis-ci.com/mgcrea/homebridge-tydom.svg?branch=master)](https://travis-ci.com/mgcrea/homebridge-tydom)
[![dependencies status](https://david-dm.org/mgcrea/homebridge-tydom/status.svg)](https://david-dm.org/mgcrea/homebridge-tydom)
[![devDependencies status](https://david-dm.org/mgcrea/homebridge-tydom/dev-status.svg)](https://david-dm.org/mgcrea/homebridge-tydom?type=dev)
[![coverage](https://codecov.io/gh/mgcrea/homebridge-tydom/branch/master/graph/badge.svg)](https://codecov.io/gh/mgcrea/homebridge-tydom)

[![Banner](https://mgcrea.github.io/homebridge-tydom/homebridge-tydom@0.5x.png)](https://mgcrea.github.io/homebridge-tydom/)

[Homebridge](https://homebridge.io/) plugin to easily manage [Tydom hardware](https://www.deltadore.fr/domotique/pilotage-maison-connectee) by [Delta Dore](https://www.deltadore.fr/) from [Apple HomeKit](https://www.apple.com/ios/home/).

- Rely on [node-tydom-client](https://github.com/mgcrea/node-tydom-client) to communicate with an existing [Tydom bridge](https://www.deltadore.fr/domotique/pilotage-maison-connectee/box-domotique/tydom-2-0-ref-6414118) (required).

- Properly propagates external events into [Apple HomeKit](https://www.apple.com/ios/home/).

- Built with [TypeScript](https://www.typescriptlang.org/) for static type checking with exported types along the library.

## Documentation

### Installation

1. Add `homebridge-tydom` plugin to your homebridge install:

- eg. using [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge), update `./volumes/homebridge/package.json`

```json
{
  "private": true,
  "description": "This file keeps track of which plugins should be installed.",
  "dependencies": {
    "homebridge-dummy": "^0.4.0",
    "homebridge-tydom": "^0.4.0"
  }
}
```

2. Configure the `homebridge-tydom` platform, providing your Tydom identifiers:

```json
{
  "bridge": {
    "name": "Homebridge 27C9",
    "username": "0E:21:1B:E7:27:C9",
    "port": 53619,
    "pin": "031-45-154"
  },
  "accessories": [],
  "platforms": [
    {
      "platform": "Tydom",
      "hostname": "mediation.tydom.com",
      "username": "001A25123456",
      "password": "YourPassw0rd",
      "settings": {
        "1528565701": {"category": 3},
        "1531745761": {"category": 3}
      }
    }
  ]
}
```

### Supported hardware

Did support the hardware that I had at home:

- Lightbulb ([TYXIA 5610](https://www.deltadore.co.uk/home-automation/lighting-control/receiver-micromodule/tyxia-5610-ref-6351400), [TYXIA 6610](https://www.deltadore.co.uk/home-automation/lighting-control/receiver-switch/tyxia-6610-ref-6351376))
- Fan ([TYXIA 6610](https://www.deltadore.co.uk/home-automation/lighting-control/receiver-switch/tyxia-6610-ref-6351376))
- Thermostat ([RF4890](https://www.deltadore.co.uk/home-automation/heating-control/receiver-micromodule/rf-4890-ref-6050615))
- Switch ([TYXIA 4620](https://www.deltadore.co.uk/home-automation/control-shutters-blinds-gate-garage/receiver-micromodule/tyxia-4620-ref-6351104))

Other similar hardware should work seamlessly with the plugin as usage is detected.

Currently working on the Alarm support however it does not seem that Homekit currently allows to enter a PIN code to arm.

Should be relatively easy to add other hardware.

### Notes

You can also use your local tydom IP (eg `192.168.0.X`) for `hostname`, however:

- You must set environment var `NODE_TLS_REJECT_UNAUTHORIZED=0` to interact with the self-signed certificate.
- Tydom 2.0 current firmware does not seem to support multiple local clients, so you would end up locking you away from the mobile app.

### Configurations

| **Field** | **Description**             |
| --------- | --------------------------- |
| hostname  | Tydom hostname              |
| username  | Tydom username              |
| password  | Tydom password              |
| settings  | Device settings (overrides) |

- The `settings` field enables you to override the name or homekit category of your Tydom device (check homebridge log for the device ids).

### Debug

This library uses [debug](https://www.npmjs.com/package/debug) to provide high verbosity logs, just pass the following environment:

```bash
DEBUG=homebridge-tydom
```

You might also want to debug [node-tydom-client](https://github.com/mgcrea/node-tydom-client)

```bash
DEBUG=homebridge-tydom,tydom-client
```

### Available scripts

| **Script**    | **Description**              |
| ------------- | ---------------------------- |
| start         | alias to `spec:watch`        |
| test          | Run all tests                |
| spec          | Run unit tests               |
| spec:coverage | Run unit tests with coverage |
| spec:watch    | Watch unit tests             |
| lint          | Run eslint static tests      |
| pretty        | Run prettier static tests    |
| build         | Compile the library          |
| build:watch   | Watch compilation            |

## Authors

**Olivier Louvignes**

- http://olouv.com
- http://github.com/mgcrea

## License

```
The MIT License

Copyright (c) 2020 Olivier Louvignes <olivier@mgcrea.io>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
