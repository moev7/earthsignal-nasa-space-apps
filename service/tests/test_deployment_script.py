"""Run the real remote release body against isolated filesystem/process adapters."""
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest


class WebDeploymentTests(unittest.TestCase):
    def run_release(self, mode):
        script=(Path(__file__).resolve().parents[2]/'scripts/deploy-web.sh').read_text()
        remote=script.split("<<'REMOTE'\n",1)[1].rsplit('\nREMOTE',1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); web=root/'web'; tools=root/'bin';tools.mkdir();web.mkdir()
            previous=web/'releases/previous';previous.mkdir(parents=True);(previous/'server.js').write_text('previous')
            (web/'current').symlink_to('releases/previous')
            content=root/'server.js';content.write_text('candidate')
            with tarfile.open(web/'candidate.tar.gz','w:gz') as archive:archive.add(content,arcname='server.js')
            def tool(name,body):
                file=tools/name;file.write_text('#!'+sys.executable+'\n'+body);file.chmod(0o700)
            tool('df',"print('Available\\n9999999999')")
            tool('chown','pass')
            tool('sleep','pass')
            tool('mv',"import os,sys;os.replace(sys.argv[-2],sys.argv[-1])")
            tool('systemctl',"""import os,sys
from pathlib import Path
root=Path(os.environ['DEPLOY_FIXTURE'])
with (root/'restarts').open('a') as f:f.write(os.readlink(root/'web/current')+'\\n')
if os.environ['DEPLOY_MODE']=='restart_failure' and os.readlink(root/'web/current')=='releases/candidate':sys.exit(1)
""")
            tool('curl',"""import os,sys
from pathlib import Path
current=os.readlink(Path(os.environ['DEPLOY_FIXTURE'])/'web/current')
if os.environ['DEPLOY_MODE']=='health_failure' and current=='releases/candidate':sys.exit(22)
print('{}')
""")
            environment=dict(os.environ,PATH=str(tools)+os.pathsep+os.environ['PATH'],DEPLOY_FIXTURE=str(root),DEPLOY_MODE=mode)
            remote=remote.replace('/opt/earthsignal/web',str(web))
            process=subprocess.run(['bash','-s','--','candidate'],input=remote,text=True,capture_output=True,env=environment,timeout=15)
            return process,os.readlink(web/'current'),(root/'restarts').read_text().splitlines(),(web/'candidate.tar.gz').exists()

    def test_restart_failure_restores_previous_and_restarts_it(self):
        result,current,restarts,archive=self.run_release('restart_failure')
        self.assertEqual(result.returncode,1,result.stderr)
        self.assertEqual(current,'releases/previous');self.assertEqual(restarts,['releases/candidate','releases/previous'])
        self.assertTrue(archive)

    def test_failed_new_health_restores_previous_and_checks_it(self):
        result,current,restarts,archive=self.run_release('health_failure')
        self.assertEqual(result.returncode,1,result.stderr)
        self.assertEqual(current,'releases/previous');self.assertEqual(restarts,['releases/candidate','releases/previous'])
        self.assertTrue(archive)

    def test_healthy_release_stays_active_and_removes_its_transfer_archive(self):
        result,current,restarts,archive=self.run_release('healthy')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(current,'releases/candidate');self.assertEqual(restarts,['releases/candidate'])
        self.assertFalse(archive)

if __name__=='__main__':unittest.main()
