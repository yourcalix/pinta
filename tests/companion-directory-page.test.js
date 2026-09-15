'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const PAGE_PATH = require.resolve('../miniprogram/subpackages/community/companion/index');
const SERVICE_PATH = require.resolve('../miniprogram/subpackages/community/companion/directory-service');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('旧目录请求跨 hide/show 不阻塞新前台请求也不覆盖新快照', async () => {
  const service = require(SERVICE_PATH);
  const originalSnapshot = service.snapshot;
  const originalPage = global.Page;
  const oldRequest = deferred();
  const newRequest = deferred();
  const requests = [oldRequest, newRequest];
  const writes = [];
  let definition;
  service.snapshot = () => requests.shift().promise;
  global.Page = (value) => { definition = value; };
  delete require.cache[PAGE_PATH];
  require(PAGE_PATH);

  const page = {
    ...definition,
    data: { ...definition.data },
    _disposed: false,
    _visible: true,
    _directoryLoadSeq: 0,
    _directoryRequestPending: false,
    _directoryRefreshQueued: false,
    _directoryEtag: '',
    _directoryPollFailureCount: 0,
    _nodes: [],
    setData(patch) { writes.push(patch); Object.assign(this.data, patch); },
    scheduleDirectoryPoll() {}
  };

  try {
    const stale = page.loadDirectory(false);
    assert.equal(page._directoryRequestPending, 1);
    page.onHide();
    assert.equal(page._directoryRequestPending, false);
    page._visible = true;
    const fresh = page.loadDirectory(false);
    assert.equal(page._directoryRequestPending, 3);

    oldRequest.resolve({ unchanged: false, etag: 'old', onlineTotal: 1, users: [{ renderKey: 'old', layoutSeed: 1 }] });
    await stale;
    assert.equal(writes.length, 0);
    assert.equal(page._directoryRequestPending, 3);

    newRequest.resolve({ unchanged: false, etag: 'new', onlineTotal: 2, users: [{ renderKey: 'new', layoutSeed: 2 }] });
    await fresh;
    assert.equal(page._directoryEtag, 'new');
    assert.equal(page.data.onlineTotal, 2);
    assert.equal(page._directoryRequestPending, false);
  } finally {
    service.snapshot = originalSnapshot;
    delete require.cache[PAGE_PATH];
    if (originalPage === undefined) delete global.Page; else global.Page = originalPage;
  }
});
