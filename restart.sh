#! /bin/bash

logger "Restart node-obsapi"

#cd /srv/www/node-obsapi/
#restart node-obsapi
sudo forever restartall
