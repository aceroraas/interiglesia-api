import { prisma } from "../services/prismaClient.js";
import fs from 'fs';
import jwt from 'jsonwebtoken'
import path from 'path';
import { fileURLToPath } from 'url';
import { generateHash } from "../services/generateHash.js";
import { getJwtSecret } from "../services/jwtSecret.js";

export const createInstallerToken = async (req, res) => {
   try {
      const { appId, entityId } = req.query;
      if (!appId || !entityId) {
         return res.status(400).json({ error: 'Falta el parámetro appId,entityId' });
      }
      const JWT_SECRET = getJwtSecret();
      const token = jwt.sign({ appId, entityId }, JWT_SECRET, { expiresIn: '1h' });
      const expiresAt = new Date(Date.now() + 3600 * 1000); // Token expira en 1 hora
      const newToken = await prisma.installationToken.create({
         data: { token, expiresAt }
      });
      res.json(newToken);
   } catch (error) {
      res.status(500).json({ error: 'No se pudo crear el token' });
   }
}


export const deleteInstallerToken = async (req, res) => {
   try {

      const installToken = req.query.install_token || req.body.install_token;
      if (!installToken) {
         return res.status(400).json({ error: 'Falta el parámetro install_token' });
      }
      await prisma.installationToken.delete({
         where: { token: installToken }
      });
      res.sendStatus(204);
   } catch (error) {
      res.status(500).json({ error: 'No se pudo eliminar el token' });
   }
}


export const getAllIntallerTokens = async (res) => {
   try {
      const tokens = await prisma.installationToken.findMany();
      res.json(tokens);
   } catch (error) {
      res.status(500).json({ error: 'No se pudo obtener los tokens' });
   }
}



export const generateInstallerFile = async (req, res) => {
   try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const installToken = req.query.install_token || req.body.install_token;

      if (!installToken) {
         return res.status(400).send('No hay Token de instalacion');
      }
      const installationToken = await prisma.installationToken.findUnique({
         where: { token: installToken },
      });
      if (!installationToken) {
         return res.status(404).send('Token de instalacion no encontrado');
      }
      let $decodeToken = jwt.decode(installToken);

      const entity = await prisma.entity.findUnique({
         where: { id: parseInt($decodeToken.entityId) },
      });

      const application = await prisma.application.findUnique({
         where: { id: parseInt($decodeToken.appId) },
      });

      let apiurl = `${req.protocol}://${req.get('host')}`;

      if (!entity || !application) {
         return res.status(404).send('Entidad, aplicación o token no encontrado');
      }

      const install_hash = generateHash(16);
      const entity_hash = entity.hashId;
      const install_token = installToken;
      const github_url = application.gitUrl;

      const installerContent = `
        #!/bin/bash

        # Clonar el repositorio de GitHub
        git clone ${github_url} || { echo "Error al clonar el repositorio."; exit 1; }

        # Obtener el nombre del directorio del repositorio clonado
        REPO_DIR=$(basename "${github_url}" .git)

        # Moverse al directorio del proyecto
        cd "\${REPO_DIR}" || { echo "Error al cambiar al directorio del proyecto."; exit 1; }
 
        # Variables de entorno
        INSTALL_HASH=${install_hash}
        ENTITY_HASH=${entity_hash}
        INSTALL_TOKEN=${install_token}
        API_URL=${apiurl}

        # Crear archivo .env
        echo "INSTALL_HASH=\${INSTALL_HASH}" > .env
        echo "ENTITY_HASH=\${ENTITY_HASH}" >> .env
        echo "INSTALL_TOKEN=\${INSTALL_TOKEN}" >> .env


           curl -X POST "${apiurl}/installer/register" \
            -H "Content-Type: application/json" \
         -d '{
              "install_hash": "${install_hash}",
            "entity_hash": "${entity_hash}",
            "install_token": "${install_token}"
            }' || { echo "Error al llamar al endpoint."; exit 1; }


        # Ejecutar el script installdb.sh
        ./installdb.sh || { echo "Error al ejecutar installdb.sh."; exit 1; }
   
        echo "Script ejecutado con éxito."
        `;

      const filePath = path.join(__dirname, 'installer.sh');
      fs.writeFile(filePath, installerContent.trim(), { mode: 0o755 }, (err) => {
         if (err) {
            return res.status(500).send('Error al escribir el archivo installer.sh');
         }

         res.download(filePath, 'installer.sh', (err) => {
            if (err) {
               return res.status(500).send('Error al descargar el archivo installer.sh');
            }
         });
      });
   } catch (error) {
      console.error(error);
      res.status(500).send('Error al generar el script installer.sh');
   }
}



export const registerInstaller = async (req, res) => {
   try {
      const { install_hash, entity_hash, install_token } = req.body;
      if (!install_hash || !entity_hash || !install_token) {
         return res.status(400).json({ error: 'Falta el parámetro install_hash, entity_hash, install_token' });
      }
      let $decodeToken = jwt.decode(install_token);
      let statusId = 1; // produccion
      let installOp = 1; // instalacion

      const ENTYAPP = await prisma.entityApplication.create({
         data: {
            entityId: parseInt($decodeToken.entityId),
            applicationId: parseInt($decodeToken.appId),
            statusId: statusId,
            install_hash: install_hash
         }
      })
      await prisma.entityInstallationHistory.create({
         data: {
            entityId: parseInt($decodeToken.entityId),
            applicationId: parseInt($decodeToken.appId),
            operationId: installOp,
            statusId: statusId,
            entityApplicationId: ENTYAPP.id
         }
      });

      res.send("registrado correctamente");
   } catch (error) {
      console.error(error);
      res.status(500).send('Error al generar el script installer.sh');

   }
}