<!-- markdownlint-disable no-inline-html -->

# homebridge-tydom

<p align="center">
  <a href="https://github.com/mgcrea/homebridge-tydom">
    <img src="https://raw.githubusercontent.com/mgcrea/homebridge-tydom/master/docs/homebridge-tydom_small.png" height="320" alt="Homebridge Tydom Logo" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-tydom">
    <img src="https://img.shields.io/npm/v/homebridge-tydom.svg?style=for-the-badge" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/homebridge-tydom">
    <img src="https://img.shields.io/npm/dt/homebridge-tydom.svg?style=for-the-badge" alt="npm total downloads" />
  </a>
  <a href="https://www.npmjs.com/package/homebridge-tydom">
    <img src="https://img.shields.io/npm/dm/homebridge-tydom.svg?style=for-the-badge" alt="npm monthly downloads" />
  </a>
  <a href="https://www.npmjs.com/package/homebridge-tydom">
    <img src="https://img.shields.io/npm/l/homebridge-tydom.svg?style=for-the-badge" alt="npm license" />
  </a>
  <a href="https://github.com/mgcrea/homebridge-tydom/actions/workflows/main.yml">
    <img src="https://img.shields.io/github/workflow/status/mgcrea/homebridge-tydom/main?style=for-the-badge" alt="github main workflow" />
  </a>
</p>

---

[Homebridge](https://homebridge.io/) plugin to easily manage [Tydom hardware](https://www.deltadore.fr/domotique/pilotage-maison-connectee) by [Delta Dore](https://www.deltadore.fr/) from [Apple HomeKit](https://www.apple.com/ios/home/).

- Rely on [node-tydom-client](https://github.com/mgcrea/node-tydom-client) to communicate with an existing [Tydom bridge](https://www.deltadore.fr/domotique/pilotage-maison-connectee/box-domotique/tydom-2-0-ref-6414118) (required).

- Properly propagates external events into [Apple HomeKit](https://www.apple.com/ios/home/).

- Built with [TypeScript](https://www.typescriptlang.org/) for static type checking with exported types along the library.

- Supports Webhooks to trigger non-homekit dependent actions or notifications.

## Documentation

### Installation

1. Add `homebridge-tydom` plugin to your homebridge install:

- eg. using [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge), update `./volumes/homebridge/package.json`

```json
{
  "private": true,
  "description": "This file keeps track of which plugins should be installed.",
  "dependencies": {
    "homebridge-tydom": "^0.15.1"
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
      "debug": true
    }
  ]
}
```

Your username is the MAC Address of your local Tydom hardware, it should be `001A25` + your 6-character home ID that you can find in the mobile app.

For your password, you can also use an environment variable `HOMEBRIDGE_TYDOM_PASSWORD` with the base64 encoded value of your password.

> Example: `HOMEBRIDGE_TYDOM_PASSWORD=Zm9vYmFyYmF6` for a `foobarbaz` password (`echo -n "foobarbaz" | base64`)

3. Configure the locale used for the labels (supported languages: `French` (default) & `English`) using the `HOMEBRIDGE_TYDOM_LOCALE` environment variable with value `fr` or `en`.

#### SecuritySystem

You can also manage your TYXAL+ security system from HomeKit (but it requires your alarm pin code):

As HomeKit security system has 3 active levels: `stay`, `night`, `away` you can configure which zones are linked to these active levels (`away` is by default every zones).

1. You need to add the following to the config `settings` field (check the logs for your actual device id).

```json
{
  "platforms": [
    {
      "settings": {
        "1521931577": {"aliases": {"stay": [3], "night": [2, 3]}}
      }
    }
  ]
}
```

2. For the pin,

You can either add a `pin` field:

```json
{
  "platforms": [
    {
      "settings": {
        "1521931577": {"pin": "123456", "aliases": {"stay": [3], "night": [2, 3]}}
      }
    }
  ]
}
```

Or you can also use an environment variable `HOMEBRIDGE_TYDOM_PIN` with the base64 encoded value of your pin (might be safer than having it inside your `config.json`).

You can optionnaly rename zones (default is `Zone 1`, `Zone 2`, etc.),

```json
{
  "platforms": [
    {
      "settings": {
        "1521931577": {"zones": ["1st Floor", "Ground Floor", "Garden"]}
      }
    }
  ]
}
```

#### Webhooks

You can specify webhooks in your `config.json` to receive non homekit-dependent notifications.

For now all `SecuritySystem` events are relayed and we only support [discord](https://ptb.discord.com/developers/docs/resources/webhook).

```json
{
  "platforms": [
    {
      "webhooks": [
        {
          "url": "https://discord.com/api/webhooks/123456/abdcdef",
          "type": "discord",
          "level": "debug"
        }
      ]
    }
  ]
}
```

#### Category overrides (eg. Fan)

You can override categories of devices (eg. some light switch used to manage a fan)

1. You need to add the following to the config `settings` field (check the logs for your actual device id).

```json
{
  "platforms": [
    {
      "settings": {
        "1528565701": {"category": 3}
      }
    }
  ]
}
```

> `3` being the `Categories.FAN` number.

### Supported hardware

It is currently supporting the following devices (have them at home).

- Lightbulb ([TYXIA 5610](https://www.deltadore.co.uk/home-automation/lighting-control/receiver-micromodule/tyxia-5610-ref-6351400), [TYXIA 6610](https://www.deltadore.co.uk/home-automation/lighting-control/receiver-switch/tyxia-6610-ref-6351376))
- Dimmable Lightbulb ([TYXIA 5650](https://www.deltadore.co.uk/home-automation/lighting-control/receiver-micromodule/tyxia-5650-ref-6351414-ref-6351414)
- Fan ([TYXIA 6610](https://www.deltadore.co.uk/home-automation/lighting-control/receiver-switch/tyxia-6610-ref-6351376))
- Thermostat ([RF4890](https://www.deltadore.co.uk/home-automation/heating-control/receiver-micromodule/rf-4890-ref-6050615))
- Switch ([TYXIA 4620](https://www.deltadore.co.uk/home-automation/control-shutters-blinds-gate-garage/receiver-micromodule/tyxia-4620-ref-6351104))
- Security System ([TYXAL+](https://www.deltadore.co.uk/home-automation/alarm/siren/si-tyxal-plus-ref-6415220))
- Contact Sensor (Door / Window) ([TYXAL+ MDO BL](https://www.deltadore.co.uk/home-automation/alarm/detector/mdo-bl-tyxal-plus-ref-6412305))

But should support many more similar devices out of the box.

Some other hardware that should work thanks to the community feedback:

- WindowCoverings ([TYXIA 5630](https://www.deltadore.co.uk/home-automation/control-shutters-blinds-gate-garage/receiver-micromodule/tyxia-5630-ref-6351401), [TYXIA 5730](https://www.deltadore.co.uk/home-automation/control-shutters-blinds-gate-garage/receiver-micromodule/tyxia-5730-ref-6351402), [TYXIA 5731](https://www.deltadore.co.uk/home-automation/control-shutters-blinds-gate-garage/receiver-micromodule/tyxia-5731-ref-6351412))

It is relatively easy to add new hardware so don't hesitate to create a new issue.

### Notes

You can also use your local tydom IP (eg `192.168.0.X`) for `hostname`, however:

- You must set environment var `NODE_TLS_REJECT_UNAUTHORIZED=0` to interact with the self-signed certificate.
- Tydom 2.0 firmware can sometimes have trouble dealing multiple local clients, locking you away from the mobile app.

### Configurations

| **Field**          | **Type**            | **Description**             |                                            |
| ------------------ | ------------------- | --------------------------- | ------------------------------------------ |
| hostname           | `string`            | Tydom hostname              |                                            |
| username           | `string`            | Tydom username              |                                            |
| password           | `string`            | Tydom password              |                                            |
| settings           | `Record<string, ?>` | Device settings (overrides) |                                            |
| includedDevices    | `Array<string>`     | number>                     | Include only devices with following ids    |
| excludedDevices    | `Array<string>`     | number>                     | Exclude all devices with following ids     |
| includedCategories | `Array<string>`     | number>                     | Include only categories with following ids |
| excludedCategories | `Array<string>`     | number>                     | Exclude all categories with following ids  |

- The `settings` field enables you to override the name or homekit category of your Tydom device (check homebridge log for the device ids).

You can also use the following environment variables (base64 encoded values)

| **Env**                   | **Description** |
| ------------------------- | --------------- |
| HOMEBRIDGE_TYDOM_PASSWORD | Tydom password  |
| HOMEBRIDGE_TYDOM_PIN      | Tyxal+ pin      |

### Help

If you open a new issue, please provide a dump of your tydom configuration using node-tydom-client:

```sh
npx tydom-client request /configs/file /devices/data /devices/meta /devices/cmeta --file tydom_output.json --username 001A25XXXXXX --password XXXXXX
```

Will create the file `tydom_output.json` to upload, you can use [https://gist.github.com](gist.github.com).

An homebridge log with [debug enabled](https://github.com/mgcrea/homebridge-tydom#debug) while using the tydom official app (to trace working requests) can also help a lot.

### Debug

This library uses [debug](https://www.npmjs.com/package/debug) to provide high verbosity logs, just pass the following environment:

```bash
DEBUG=homebridge-tydom
```

You might also want to debug [node-tydom-client](https://github.com/mgcrea/node-tydom-client)

```bash
DEBUG=homebridge-tydom,tydom-client
```

Alternatively, you can set `debug` to `true` in the plugin's configuration.

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
