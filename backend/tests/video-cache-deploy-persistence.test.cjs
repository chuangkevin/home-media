const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { after, before, test } = require('node:test')

const repoRoot = path.resolve(__dirname, '../..')
const helper = path.join(repoRoot, 'scripts/persist-video-cache.sh')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'video-cache-deploy-test-'))

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents)
  fs.chmodSync(filePath, 0o755)
}

before(() => {
  const binDir = path.join(tempRoot, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  writeExecutable(path.join(binDir, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
cmd=$1
shift
case "$cmd" in
  info) exit 0 ;;
  container)
    [[ "\${1:-}" == inspect ]] || exit 2
    [[ "\${MOCK_CONTAINER_PRESENT:-true}" == true ]]
    exit
    ;;
  inspect)
    format=$2
    case "$format" in
      *State.Running*) printf '%s\\n' "\${MOCK_CONTAINER_RUNNING:-true}" ;;
      *Mounts*) printf '%s' "\${MOCK_MOUNT_RECORD:-}" ;;
      *) exit 2 ;;
    esac
    ;;
  exec)
    shift
    subcmd=$1
    shift
    case "$subcmd" in
      node)
        script=\${2:-}
        if [[ "$script" == *'/proc/1/cwd'* ]]; then
          printf '%s' "\${MOCK_CONTAINER_CWD:-/app}"
        elif [[ "$script" == *'lstatSync'* ]]; then
          node -e 'const fs=require("fs"),p=process.env.MOCK_CONTAINER_CACHE;let s;try{s=fs.lstatSync(p)}catch(e){if(e.code==="ENOENT"){process.stdout.write("missing");process.exit(0)}process.exit(1)}if(s.isSymbolicLink()){process.stdout.write("symlink");process.exit(0)}if(!s.isDirectory()){process.stdout.write("other");process.exit(0)}if(fs.readdirSync(p,{withFileTypes:true}).some(e=>e.isSymbolicLink()&&e.name.endsWith(".mp4"))){process.stdout.write("linked-file");process.exit(0)}process.stdout.write("directory")'
        elif [[ "$script" == *'readdirSync(p'* ]]; then
          count=0
          bytes=0
          for file in "\${MOCK_CONTAINER_CACHE:?}"/*.mp4; do
            [[ -f "$file" && "$file" != *.tmp.mp4 ]] || continue
            size=$(stat -c '%s' -- "$file")
            ((count += 1))
            ((bytes += size))
          done
          printf '%s %s' "$count" "$bytes"
        else
          exit 2
        fi
        ;;
      test)
        [[ "$1" == -d ]] || exit 2
        [[ -d "\${MOCK_CONTAINER_CACHE:?}" ]]
        ;;
      find)
        # Emit container paths rather than the fixture's local paths, as Docker would.
        shift
        find "\${MOCK_CONTAINER_CACHE:?}" "$@" | while IFS= read -r -d '' file; do
          printf '/app/data/video-cache/%s\\0' "\${file##*/}"
        done
        ;;
      stat)
        name=\${@: -1}
        if [[ -n "\${MOCK_CONTAINER_STAT_SIZE:-}" ]]; then
          printf '%s' "$MOCK_CONTAINER_STAT_SIZE"
        else
          stat -c '%s' -- "\${MOCK_CONTAINER_CACHE:?}/\${name##*/}"
        fi
        ;;
      sha256sum)
        name=\${@: -1}
        sha256sum -- "\${MOCK_CONTAINER_CACHE:?}/\${name##*/}"
        ;;
      *) exit 2 ;;
    esac
    ;;
  cp)
    [[ -z "\${MOCK_DOCKER_CP_LOG:-}" ]] || printf 'copy\\n' >> "\${MOCK_DOCKER_CP_LOG}"
    [[ "\${MOCK_DOCKER_CP_FAIL:-false}" != true ]] || exit 1
    source_path=$1
    destination=$2
    cp -- "\${MOCK_CONTAINER_CACHE:?}/\${source_path##*/}" "$destination"
    ;;
  *) exit 2 ;;
esac
`)
  writeExecutable(path.join(binDir, 'df'), `#!/usr/bin/env bash
if [[ -n "\${MOCK_DF_AVAILABLE_KB:-}" ]]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
  printf 'mock 100 1 %s 1%% /tmp\\n' "$MOCK_DF_AVAILABLE_KB"
else
  exec /usr/bin/df "$@"
fi
`)
})

after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

function makeEnv({ containerCache, containerPresent = true, mountRecord = '', extra = {} }) {
  return {
    ...process.env,
    PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
    MOCK_CONTAINER_CACHE: containerCache,
    MOCK_CONTAINER_PRESENT: String(containerPresent),
    MOCK_MOUNT_RECORD: mountRecord,
    ...extra,
  }
}

function runHelper(mode, cwd, manifest, env) {
  return spawnSync('bash', [helper, mode, manifest], {
    cwd,
    env,
    encoding: 'utf8',
  })
}

function fixture() {
  const cwd = fs.mkdtempSync(path.join(tempRoot, 'deploy-'))
  const source = path.join(cwd, 'old-container-cache')
  fs.mkdirSync(source, { recursive: true })
  const manifest = path.join(cwd, 'manifest')
  return { cwd, source, manifest, hostCache: path.join(cwd, 'data/video-cache') }
}

function workflowRun(stepName) {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8')
  const marker = `      - name: ${stepName}\n`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `workflow step not found: ${stepName}`)
  const afterStart = workflow.slice(start + marker.length)
  const nextStep = afterStart.indexOf('\n      - name:')
  const step = nextStep === -1 ? afterStart : afterStart.slice(0, nextStep)
  const lines = step.split('\n')
  const runLine = lines.findIndex((line) => line === '        run: |')
  assert.notEqual(runLine, -1, `run block not found: ${stepName}`)
  const rendered = []
  for (const line of lines.slice(runLine + 1)) {
    if (line.trim() === '') {
      rendered.push('')
      continue
    }
    if (!line.startsWith('          ')) break
    rendered.push(line.slice(10))
  }
  return rendered.join('\n').replace(/\n*$/, '\n')
}

function remoteBodies(runScript) {
  return [...runScript.matchAll(/<<'REMOTE'\n([\s\S]*?)\n\s*REMOTE(?:\n|$)/g)].map((match) => match[1])
}

test('prepares complete MP4s twice, skips partial yt-dlp output, and verifies bind-mounted content', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  const stable = 'stable_123.mp4'
  const later = 'later_456.mp4'
  fs.writeFileSync(path.join(f.source, stable), 'completed-video-a')
  fs.writeFileSync(path.join(f.source, 'partial_789.tmp.mp4'), 'partial-video')

  const first = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: f.source }))
  assert.equal(first.status, 0, first.stderr)
  assert.deepEqual(fs.readFileSync(path.join(f.hostCache, stable)), Buffer.from('completed-video-a'))
  assert.equal(fs.existsSync(path.join(f.hostCache, 'partial_789.tmp.mp4')), false)
  assert.match(first.stdout, /video_cache_prepare: count=1 total_bytes=17 same_content=true/)
  assert.doesNotMatch(first.stdout, /stable_123|partial_789|[a-f0-9]{64}/)

  fs.writeFileSync(path.join(f.source, later), 'completed-video-b')
  const second = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: f.source }))
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(fs.readFileSync(path.join(f.hostCache, later)), Buffer.from('completed-video-b'))
  assert.match(second.stdout, /video_cache_prepare: count=2 total_bytes=34 same_content=true/)
  assert.doesNotMatch(second.stdout, /stable_123|later_456|partial_789|[a-f0-9]{64}/)

  const hostCache = fs.realpathSync(f.hostCache)
  fs.writeFileSync(path.join(f.hostCache, 'new_987.mp4'), 'arrived-after-start')
  const verify = runHelper('verify', f.cwd, f.manifest, makeEnv({
    containerCache: f.hostCache,
    mountRecord: `bind|${hostCache}`,
  }))
  assert.equal(verify.status, 0, verify.stderr)
  assert.match(verify.stdout, /video_cache_verify: count=3 total_bytes=\d+ same_content=true/)
  assert.doesNotMatch(verify.stdout, /stable_123|later_456|new_987|[a-f0-9]{64}/)
})

test('reports a retained-content mismatch when an original entry changes after startup', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  const filename = 'original_123.mp4'
  fs.writeFileSync(path.join(f.source, filename), 'completed-video')
  const prepared = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: f.source }))
  assert.equal(prepared.status, 0, prepared.stderr)
  fs.writeFileSync(path.join(f.hostCache, filename), 'changed-after-start')
  const hostCache = fs.realpathSync(f.hostCache)
  const verify = runHelper('verify', f.cwd, f.manifest, makeEnv({
    containerCache: f.hostCache,
    mountRecord: `bind|${hostCache}`,
  }))
  assert.notEqual(verify.status, 0)
  assert.match(verify.stdout, /same_content=false/)
  assert.doesNotMatch(`${verify.stdout}${verify.stderr}`, /original_123|changed-after-start|[a-f0-9]{64}/)
})

test('preserves a conflicting host file and fails before any container stop or overwrite', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  const filename = 'same_video_123.mp4'
  fs.writeFileSync(path.join(f.source, filename), 'old-container-copy')
  fs.mkdirSync(f.hostCache, { recursive: true })
  fs.writeFileSync(path.join(f.hostCache, filename), 'host-good-copy')

  const result = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: f.source }))
  assert.notEqual(result.status, 0)
  assert.deepEqual(fs.readFileSync(path.join(f.hostCache, filename)), Buffer.from('host-good-copy'))
  assert.deepEqual(fs.readdirSync(f.hostCache), [filename])
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /same_video_123|old-container-copy|host-good-copy/)
})

test('aborts a failed copy without modifying existing host files', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  fs.writeFileSync(path.join(f.source, 'cache_123video.mp4'), 'completed-video')

  const result = runHelper('prepare', f.cwd, f.manifest, makeEnv({
    containerCache: f.source,
    extra: { MOCK_DOCKER_CP_FAIL: 'true' },
  }))
  assert.notEqual(result.status, 0)
  assert.deepEqual(fs.readdirSync(f.hostCache), [])
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /cache_123video|completed-video/)
})

test('checks migration size and free disk before copying any cache file', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  fs.writeFileSync(path.join(f.source, 'cache_123video.mp4'), 'completed-video')
  const copyLog = path.join(f.cwd, 'copy.log')
  const result = runHelper('prepare', f.cwd, f.manifest, makeEnv({
    containerCache: f.source,
    extra: { MOCK_DF_AVAILABLE_KB: '0', MOCK_DOCKER_CP_LOG: copyLog },
  }))
  assert.notEqual(result.status, 0)
  assert.equal(fs.existsSync(copyLog), false)
  assert.deepEqual(fs.readdirSync(f.hostCache), [])

  const overLimitCopyLog = path.join(f.cwd, 'over-limit-copy.log')
  const overLimit = runHelper('prepare', f.cwd, f.manifest, makeEnv({
    containerCache: f.source,
    extra: {
      MOCK_CONTAINER_STAT_SIZE: String(5000 * 1024 * 1024 + 1),
      MOCK_DOCKER_CP_LOG: overLimitCopyLog,
    },
  }))
  assert.notEqual(overLimit.status, 0)
  assert.equal(fs.existsSync(overLimitCopyLog), false)
  assert.deepEqual(fs.readdirSync(f.hostCache), [])
})

test('treats a missing legacy cache directory as a normal empty migration', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  const missing = path.join(f.cwd, 'missing-old-cache')
  const result = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: missing }))
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /video_cache_prepare: count=0 total_bytes=0 same_content=true/)
  assert.deepEqual(fs.readdirSync(f.hostCache), [])
})

test('fails closed for symlinked legacy cache directories or completed entries', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  const actual = path.join(f.cwd, 'actual-cache')
  fs.mkdirSync(actual)
  fs.writeFileSync(path.join(actual, 'linked_123.mp4'), 'completed-video')
  const linked = path.join(f.cwd, 'linked-cache')
  fs.symlinkSync(actual, linked, 'dir')
  const linkedDir = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: linked }))
  assert.notEqual(linkedDir.status, 0)

  const entry = path.join(f.source, 'linked_456.mp4')
  fs.symlinkSync(path.join(actual, 'linked_123.mp4'), entry)
  const linkedFile = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: f.source }))
  assert.notEqual(linkedFile.status, 0)
  assert.deepEqual(fs.readdirSync(f.hostCache), [])
  assert.doesNotMatch(`${linkedDir.stdout}${linkedDir.stderr}${linkedFile.stdout}${linkedFile.stderr}`, /linked_123|linked_456/)
})

test('rejects a post-deploy container without the expected bind mount', (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.cwd, { recursive: true, force: true }))
  fs.writeFileSync(path.join(f.source, 'cache_123video.mp4'), 'completed-video')
  const prepared = runHelper('prepare', f.cwd, f.manifest, makeEnv({ containerCache: f.source }))
  assert.equal(prepared.status, 0, prepared.stderr)
  const verify = runHelper('verify', f.cwd, f.manifest, makeEnv({
    containerCache: f.hostCache,
    mountRecord: 'volume|unexpected-volume',
  }))
  assert.notEqual(verify.status, 0)
  assert.doesNotMatch(`${verify.stdout}${verify.stderr}`, /cache_123video|[a-f0-9]{64}/)
})

test('compose and deploy wiring use a minimal additive override and verify before success', () => {
  const baseCompose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8')
  const override = fs.readFileSync(path.join(repoRoot, 'docker-compose.video-cache.yml'), 'utf8')
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'backend/Dockerfile'), 'utf8')
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8')

  assert.match(baseCompose, /- \.\/data\/video-cache:\/app\/data\/video-cache/)
  assert.match(override, /services:\s*backend:\s*volumes:\s*- \.\/data\/video-cache:\/app\/data\/video-cache/s)
  assert.doesNotMatch(override, /frontend|ports:|environment:|networks:/)
  assert.doesNotMatch(dockerfile, /^\s*VOLUME\b/m)
  assert.match(workflow, /scp[\s\S]*docker-compose\.video-cache\.yml scripts\/persist-video-cache\.sh/)
  assert.doesNotMatch(workflow, /scp[^\n]*docker-compose\.yml\b/)

  const config = workflow.indexOf('compose config -q')
  const initialPrepare = workflow.indexOf('bash scripts/persist-video-cache.sh prepare "$video_cache_manifest"')
  const pull = workflow.indexOf('            retry_pull\n', initialPrepare)
  const lastPrepare = workflow.lastIndexOf('bash scripts/persist-video-cache.sh prepare "$video_cache_manifest"')
  const stop = workflow.indexOf('docker stop --time 30 home-media-backend home-media-frontend')
  const up = workflow.indexOf('compose up -d --force-recreate --no-deps backend frontend')
  const verify = workflow.indexOf('bash scripts/persist-video-cache.sh verify "$video_cache_manifest"')
  assert.ok(config >= 0 && config < initialPrepare)
  assert.ok(initialPrepare < pull && pull < lastPrepare && lastPrepare < stop)
  assert.ok(stop < up && up < verify)
  assert.match(workflow, /docker compose -f docker-compose\.yml -f docker-compose\.video-cache\.yml/)
  assert.doesNotMatch(workflow, /compose down|--remove-orphans/)
  assert.doesNotMatch(workflow, /docker ps -a --filter "name=home-media"|xargs -r docker rm -f/)
  assert.doesNotMatch(workflow, /docker (image|volume|system|network) prune/)
  assert.match(workflow, /compose pull backend frontend/)
  assert.match(workflow, /compose up -d --force-recreate --no-deps backend frontend/)
  assert.match(workflow, /cp -p -- "\$target" "\$target\.bak\.\$run_key"/)
  assert.match(workflow, /group: home-media-deploy\s+cancel-in-progress: false/)
})

test('rendered local and remote deploy shells parse and safely handle a quoted deployment path', (t) => {
  const stageRun = workflowRun('Stage video-cache deployment files')
  const deployRun = workflowRun('Deploy via SSH')
  for (const script of [stageRun, deployRun]) {
    const parsed = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
    assert.equal(parsed.status, 0, parsed.stderr)
  }

  const stageBodies = remoteBodies(stageRun)
  const deployBodies = remoteBodies(deployRun)
  assert.equal(stageBodies.length, 2)
  assert.equal(deployBodies.length, 1)
  for (const body of [...stageBodies, ...deployBodies]) {
    const parsed = spawnSync('bash', ['-n'], { input: body, encoding: 'utf8' })
    assert.equal(parsed.status, 0, parsed.stderr)
  }

  const quotedStagePath = path.join(tempRoot, "stage with ' quote")
  const encodedStagePath = Buffer.from(quotedStagePath).toString('base64')
  const makeStage = spawnSync('bash', ['-s', '--', encodedStagePath], {
    input: stageBodies[0],
    encoding: 'utf8',
  })
  assert.equal(makeStage.status, 0, makeStage.stderr)
  assert.equal(fs.statSync(quotedStagePath).isDirectory(), true)
  const existingStage = spawnSync('bash', ['-s', '--', encodedStagePath], {
    input: stageBodies[0],
    encoding: 'utf8',
  })
  assert.notEqual(existingStage.status, 0)
  const stageTarget = path.join(tempRoot, "stage target ' quote")
  const stageLink = path.join(tempRoot, 'stage-link')
  fs.mkdirSync(stageTarget)
  fs.symlinkSync(stageTarget, stageLink, 'dir')
  const linkedStage = spawnSync('bash', ['-s', '--', Buffer.from(stageLink).toString('base64')], {
    input: stageBodies[0],
    encoding: 'utf8',
  })
  assert.notEqual(linkedStage.status, 0)

  const deployPath = path.join(tempRoot, "deploy with ' quote")
  const stageName = '.video-cache-deploy-test'
  const runKey = 'test-attempt'
  fs.mkdirSync(path.join(deployPath, stageName), { recursive: true })
  fs.mkdirSync(path.join(deployPath, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(deployPath, 'docker-compose.video-cache.yml'), 'old override')
  fs.writeFileSync(path.join(deployPath, 'scripts/persist-video-cache.sh'), 'old helper')
  fs.writeFileSync(path.join(deployPath, stageName, 'docker-compose.video-cache.yml'), 'new override')
  fs.writeFileSync(path.join(deployPath, stageName, 'persist-video-cache.sh'), 'new helper')
  const install = spawnSync('bash', ['-s', '--', stageName, runKey, Buffer.from(deployPath).toString('base64')], {
    input: stageBodies[1],
    encoding: 'utf8',
  })
  assert.equal(install.status, 0, install.stderr)
  assert.equal(fs.readFileSync(path.join(deployPath, 'docker-compose.video-cache.yml'), 'utf8'), 'new override')
  assert.equal(fs.readFileSync(path.join(deployPath, 'scripts/persist-video-cache.sh'), 'utf8'), 'new helper')
  assert.equal(fs.readFileSync(path.join(deployPath, `docker-compose.video-cache.yml.bak.${runKey}`), 'utf8'), 'old override')
  assert.equal(fs.readFileSync(path.join(deployPath, `scripts/persist-video-cache.sh.bak.${runKey}`), 'utf8'), 'old helper')
  assert.equal(fs.existsSync(path.join(deployPath, stageName)), false)

  const unsafeDeployPath = path.join(tempRoot, "unsafe scripts dir ' quote")
  const unsafeStageName = '.video-cache-deploy-unsafe'
  fs.mkdirSync(path.join(unsafeDeployPath, unsafeStageName), { recursive: true })
  fs.writeFileSync(path.join(unsafeDeployPath, unsafeStageName, 'docker-compose.video-cache.yml'), 'override')
  fs.writeFileSync(path.join(unsafeDeployPath, unsafeStageName, 'persist-video-cache.sh'), 'helper')
  const outsideScripts = path.join(tempRoot, 'outside-scripts')
  fs.mkdirSync(outsideScripts)
  fs.symlinkSync(outsideScripts, path.join(unsafeDeployPath, 'scripts'), 'dir')
  const rejectSymlinkScripts = spawnSync('bash', ['-s', '--', unsafeStageName, runKey, Buffer.from(unsafeDeployPath).toString('base64')], {
    input: stageBodies[1],
    encoding: 'utf8',
  })
  assert.notEqual(rejectSymlinkScripts.status, 0)
  assert.deepEqual(fs.readdirSync(outsideScripts), [])

  const deployPathLine = deployBodies[0].split('\n').find((line) => line.includes('deploy_path=$(printf'))
  assert.ok(deployPathLine)
  const checkDecode = spawnSync('bash', ['-c', `set -euo pipefail\n${deployPathLine}\n[[ "$deploy_path" == "$EXPECTED_PATH" ]]`, '--', Buffer.from(deployPath).toString('base64')], {
    env: { ...process.env, EXPECTED_PATH: deployPath },
    encoding: 'utf8',
  })
  assert.equal(checkDecode.status, 0, checkDecode.stderr)
  assert.match(stageRun, /"\$DEPLOY_USER@\$DEPLOY_SERVER_IP:\$remote_stage\/"/)
})

test('manifest uses hashes only internally and limits migration to 5000 MiB', () => {
  const helperSource = fs.readFileSync(helper, 'utf8')
  assert.match(helperSource, /max_cache_bytes=\$\(\(5000 \* 1024 \* 1024\)\)/)
  assert.match(helperSource, /sha256sum/)
  assert.match(helperSource, /printf 'video_cache_%s: count=%s total_bytes=%s same_content=%s\\n'/)
})
