MIT License

Copyright 2015-2026 Chen, Yi-Cyuan

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---
Source: js-sha3 (https://github.com/emn178/js-sha3), build/sha3.min.js, version 0.13.0 --
vendored the same way vendor/ethers.umd.min.js and vendor/solanaWeb3.min.js are (no CDN, so a
version stays pinned across every clone of this repo), for the one remaining Keccak-256
primitive this page needs client-side (registry_solana's normalized_handle_key) now that
ethers.js itself has been removed along with EVM support. Exposes a global keccak256()
function (and friends) directly on window -- see js-sha3's own UMD wrapper, which assigns its
exports onto `window` in a browser context rather than namespacing them.
