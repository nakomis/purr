"""A tiny driver for `anicraft-cli serve`: one JSON command per line, one reply per line.

Unlike `anicraft-cli run`, replies come back as we go, so a script can use the
ids AniCraft hands out (layers, symbols, elements) in later commands.
"""
import json, subprocess

CLI = '/Applications/AniCraft.app/Contents/MacOS/anicraft-cli'


class AniCraftError(RuntimeError):
    pass


class AC:
    def __init__(self, path):
        self.p = subprocess.Popen([CLI, 'serve', path], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, bufsize=1)
        hello = json.loads(self.p.stdout.readline())
        assert hello.get('ready'), hello
        self.n = 0

    def __call__(self, cmd, **params):
        self.n += 1
        self.p.stdin.write(json.dumps({'id': self.n, 'cmd': cmd, 'params': params}) + '\n')
        reply = json.loads(self.p.stdout.readline())
        if not reply.get('ok'):
            raise AniCraftError(f'{cmd} {params}: {reply.get("error")}')
        return reply.get('result')

    def close(self):
        self.p.stdin.close()
        self.p.wait()
