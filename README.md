# Yubikey HOTP for webusb

This is mostly an experiment to try webusb in the context of yubikey hotp
authentication. If you randomly ended up here, you probably just want to use
u2f on the yubikey site.

## Instructions

You have to set the development/experimental flags for your chromium/chrome
browser to work with webusb(as described [here](https://developers.google.com/web/updates/2016/03/access-usb-devices-on-the-web)):

1. navigate to chrome://flags
2. Enable the flag called "Experimental web platform features".
3. Close your browser.

In addition I also added the following flags before relaunching:
`--disable-webusb-security` and `--allow-insecure-localhost`.
[Here](https://peter.sh/experiments/chromium-command-line-switches/) is a very
interesting list of flags in case you are curious.  After having relaunched
chromium with the flags, you need to serve the website.

You can serve the website easily by doing

```bash
$ python -m http.server
```

If you're using python 3. You can use any other http server to serve the
website.

### Setting up the yubikey for HOTP 

You need to setup the yubikey for HOTP mode using the yubikey personalization
tool. There is a friendly GUI version. You will need to setup HOTP mode on slot
*2*, as that's the slot that's hardcoded on this script.

If you're on Linux, You will probably have to unbind the key from usbhid's
grasp before the interface can be claimed by chromium/chrome:

```bash
$ sudo sh -c "echo '[USB-DEVICE-NO]:1.0' > /sys/bus/usb/drivers/usbhid/unbind"
```

You can get the device number from dmesg or lsusb -t. For example, this is the
one I did to unbind my key:

```bash
$ sudo sh -c "echo '1-3:1.0' > /sys/bus/usb/drivers/usbhid/unbind"
```

You can also write a udev rule for this, but I won't get into those details
here.

Done, now you're ready to test the website, you need to select the device, and
then fill in the challenge field. Click on `send` and then touch the yubikey to
obtain your HMAC-SHA1 OTP :beers:.
