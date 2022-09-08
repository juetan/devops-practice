## 基本内容
实践要求：

- 至少1台服务器/虚拟机(最好2台，一台为主服务器，一台为子服务器，单台也行)
- 至少1个域名(解析到国内服务器需备案)
- 具备docker基本操作知识

实践内容：

- 基于`docker`的容器部署平台(`docker`+`swarm`+`traefik`+`portainer`)。
- 基于`docker registry`的容器管理平台。
- 基于`droneci`的代码构建平台。
- 基于`gitea`的代码管理平台。

实践项目

- SpringBoot + Vue前后端分离项目
- SpringCloud微服务项目

准备工作

- 将`*.dev.juetan.cn`解析到主服务器，用于基础设施的访问
- 将`*.app.juetan.cn`解析到主服务器，用于部署应用的访问
- 在主服务器上，新建`/docker`目录

部署场景：

- 开发服务器(`dev`)
- 测试服务器(`test`)
- 部署服务器(`pre`)
- 生产服务器(`app`)
- 演示服务器(`demo`)
<a name="e0f661f5"></a>
## 实践步骤
<a name="85fe5099"></a>
### 创建容器集群

1. 在主服务器上，执行以下命令，初始化集群
```
docker swarm init
```

2. 在主服务器上，执行以下命令，查看加入集群的令牌
```
docker swarm join-token worker
```

3. 在子服务器上，执行以下命令，加入集群
```
docker swarm jorin --token xx ip:port
```

4. 在主服务器上，编写一个简单的服务
```
version: "3.4"
```

5. 在主服务器上，启动服务
```
docker stack deploy -c <config.yml> <stack_name>
```
<a name="NE0gL"></a>
### 创建基础服务

- 在主服务器上，执行以下命令，创建公共网络：
```
docker network create -d overlay public
```

- 在主服务器上，执行以下命令，创建`Traefik`需要的配置文件
```bash
# 创建目录
$ mkdir -p /docker/traefik && cd /docker/traefik

# 创建启动配置文件(添加内容在后面)
$ touch traefik-stack.yml

# 创建HTTPS证书配置文件(内容为空即可)
$ touch acme.json && chmod 600 acme.json 

# 创建Traefik配置文件(内容)
$ touch traefik.toml

# 创建Treafik日志目录：traefik日志+access日志+acme日志
$ mkdir logs
```

- 修改`/docker/traefik/traefik.toml`文件，添加内容如下
```toml
debug = false

logLevel = "ERROR"
[traefikLog]
  filePath = "/logs/traefik.log"
  format   = "json"
[accessLog]
  filePath = "/logs/access.log"
  format = "json"
defaultEntryPoints = ["https","http"]

[entryPoints]
  [entryPoints.http]
    address = ":80"
  [entryPoints.https]
    address = ":443"
  [entryPoints.https.tls]

[retry]

[docker]
endpoint = "unix:///var/run/docker.sock"
domain = "juetan.cn"
swarmmode = true
watch = true
exposedbydefault = false

[acme]
email = "contact@juetan.cn"
storage = "acme.json"
entryPoint = "https"
acmeLogging=true
onHostRule=true
caServer = "https://acme-v02.api.letsencrypt.org/directory"
[acme.httpChallenge]
  entryPoint = "http"
```

- 修改/`/docker/traefik/traefik-stack.yml`文件，添加内容如下
```yaml
version: "3.4"

services:
  # 网络代理
  traefik:
    image: traefik:1.7
    command: --configFile=/traefik.toml
    deploy:
      placement:
        constraints:
          - node.role==manager
    ports:
      - "80:80"
      - "443:443"
    networks:
      - public
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /docker/traefik/traefik.toml:/traefik.toml
      - /docker/traefik/acme.json:/acme.json
      - /docker/traefik/logs:/logs
  
  # 容器代理
  agent:
    image: portainer/agent:2.14.2
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /var/lib/docker/volumes:/var/lib/docker/volumes
    networks:
      - agent_network
    deploy:
      mode: global
      placement:
        constraints: [node.platform.os == linux]
  
  # 容器管理
  server:
    image: portainer/portainer-ce:2.14.2
    command: -H tcp://tasks.agent:9001 --tlsskipverify
    volumes:
      - base_port:/data
    networks:
      - agent_network
      - public
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints: [node.role == manager]
      labels:
        traefik.backend: "portainer"
        traefik.frontend.rule: "Host:port.dev.juetan.cn"
        traefik.docker.network: "public"
        traefik.enable: "true"
        traefik.port: "9000"
        traefik.frontend.entryPoints: "http,https"
        traefik.frontend.redirect.entryPoint: "http"

networks:
  agent_network:
    driver: overlay
    attachable: true
  public:
    external: true
volumes:
  base_port:
```
<a name="EPt3R"></a>
### 创建核心服务

1. 在`Portainer`页面中，选择`volumes`，创建如下数据卷：
```bash
docker volume create infrastructure_myqsl
docker volume create infrastructure_gitea
docker volume create infrastructure_drone
docker volume create infrastructure_registry
```

2. 在`Portainer`页面中，依次选择`Stacks`- `Add Stack`，填写`name`为`base`，内容如下：
```yaml
version: '3.4'

services:
  # 数据仓库
  mysql:
    image: mysql:5.7
    command: --default-authentication-plugin=mysql_native_password --character-set-server=utf8mb4 --collation-server=utf8mb4_bin --default-storage-engine=INNODB --max_allowed_packet=256M --innodb_log_file_size=2GB --transaction-isolation=READ-COMMITTED --binlog_format=row
    networks:
      - public
    ports:
      - 13306:3306
    volumes:
      - infrastructure_mysql:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: root
    security_opt:
      - seccomp:unconfined
    deploy:
      placement:
        constraints:
          - node.role==manager

  # 代码仓库
  gitea:
    image: gitea/gitea:1.16.8
    volumes:
      - infrastructure_gitea:/data
    networks:
      - public
    environment:
      - APP_NAME=代码仓库
      - RUN_MODE=prod
      - DOMAIN=git.dev.juetan.cn
      - ROOT_URL=http://git.dev.juetan.cn
      - DISABLE_SSH=true
      - ENABLE_GZIP=true
      - SSH_PORT=2222
      - DISABLE_REGISTRATION=true
      - REQUIRE_SIGNIN_VIEW=true
      - USER_UID=1000
      - USER_GID=1000
      - DB_TYPE=mysql
      - DB_HOST=mysql:3306
      - DB_NAME=gitea
      - DB_USER=root
      - DB_PASSWD=root
    deploy:
      placement:
        constraints:
          - node.role==manager
      labels:
        - 'traefik.port=3000'
        - 'traefik.enable=true'
        - 'traefik.docker.network=public'
        - 'traefik.frontend.rule=Host:git.dev.juetan.cn'
        - 'traefik.frontend.entryPoints=http, https'
        - 'traefik.frontend.redirect.entryPoint=http'

  # 容器仓库
  registry:
    image: registry:2
    networks:
      - public
    volumes:
      - infrastructure_registry:/var/lib/registry
    deploy:
      placement:
        constraints:
          - node.role==manager
      labels:
        - 'traefik.port=5000'
        - 'traefik.enable=true'
        - 'traefik.docker.network=public'
        - 'traefik.frontend.rule=Host:registry.dev.juetan.cn'
        - 'traefik.frontend.entryPoints=http,https'
        - 'traefik.frontend.redirect.entryPoint=http'

  # 构建中心
  drone-server:
    image: drone/drone:latest
    environment:
      - DRONE_TLS_AUTOCERT=false
      - DRONE_AGENTS_ENABLED=true
      - DRONE_GITEA_SERVER=http://git.dev.juetan.cn
      - DRONE_GITEA_CLIENT_ID=214e79d8-08bd-4b55-8111-b9fc3ecb564e
      - DRONE_GITEA_CLIENT_SECRET=UCZStx5EULnkzWd26NfK7pJB0NE48zD8Zvo7LTBSHoTA
      - DRONE_RPC_SECRET=1eade7915d5f817ee1a64eeba165c502
      - DRONE_SERVER_HOST=ci.dev.juetan.cn
      - DRONE_SERVER_PROTO=http
      - DRONE_GIT_ALWAYS_AUTH=false
    networks:
      - public
    volumes:
      - infrastructure_drone:/data
    deploy:
      placement:
        constraints:
          - node.role==manager
      labels:
        - 'traefik.port=80'
        - 'traefik.enable=true'
        - 'traefik.docker.network=public'
        - 'traefik.frontend.rule=Host:ci.dev.juetan.cn'
        - 'traefik.frontend.entryPoints=http, https'
        - 'traefik.frontend.redirect.entryPoint=http'

  # 构建容器
  drone-runner:
    image: drone/drone-runner-docker:latest
    environment:
      - DRONE_RPC_PROTO=http
      - DRONE_RPC_HOST=ci.dev.juetan.cn
      - DRONE_RPC_SECRET=1eade7915d5f817ee1a64eeba165c502
      - DRONE_RUNNER_CAPACITY=2
      - DRONE_RUNNER_NAME=AGENT-CCTOMATO-001
    networks:
      - public
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    deploy:
      placement:
        constraints:
          - node.role==manager

networks:
  public:
    external: true

volumes:
  infrastructure_mysql:
    external: true
  infrastructure_gitea:
    external: true
  infrastructure_registry:
    external: true
  infrastructure_drone:
    external: true
```

3. 点击`Deploy the stack`，等待服务部署完成。
3. 使用`DBeaver`连接`Mysql`，创建数据库`gitea`
3. 访问`http://git.dev.juetan.cn`完成创建，点击`设置-应用`创建应用如下：
```
应用名称：DroneCI(可任意名称)
重定向地址：http://ci.dev.juetan.cn/login
```

6. 复制客户端ID和客户端密钥，更新stack.yml文件，然后重启服务
<a name="9b7f8ff7"></a>
## 项目实践
接下来是项目实践，部署一个前后端分离，前端为Vue，后端为Spring的项目，项目地址在[这里](https://github.com/Heeexy/SpringBoot-Shiro-Vue)。
<a name="9abfe4a0"></a>
### 前端配置
根目录下新建`.drone.yml`文件，添加如下内容：
```yaml
kind: pipeline
name: default
steps:
  - name: build
    image: node:14.16.1
    commands:
      - npm install --registry=https://registry.npm.taobao.org
      - npm run build
  - name: docker
    image: plugins/docker
    settings:
      repo: registry.dev.juetan.cn/project/ssvweb
      registry: registry.dev.juetan.cn
      insecure: true
      force_tag: true
      tags: latest
  - name: deploy
    image: appleboy/drone-ssh
    settings:
      host:
        from_secret: DEPLOY_HOST
      username:
        from_secret: DEPLOY_USER
      password:
        from_secret: DEPLOY_PASSWORD
      port:
        from_secret: DEPLOY_PORT
      script:
        - docker service update --image registry.dev.juetan.cn/project/ssvserver:latest ssv_server
```
根目录下新建`Dockerfile`文件，添加如下内容：
```bash
FROM nginx
COPY ./dist /usr/share/nginx/html
ENTRYPOINT ["nginx","-g","daemon off;"]
```
<a name="e778d61a"></a>
### 后端配置
根目录下新建`.drone.yml`文件，添加如下内容：
```
kind: pipeline
name: default
steps:
  - name: build
    image: maven:3.3-jdk-8-alpine
    commands:
      - mvn clean package
  - name: docker
    image: plugins/docker
    settings:
      repo: registry.dev.juetan.cn/project/ssvserver
      registry: registry.dev.juetan.cn
      insecure: true
      force_tag: true
      tags: latest
  - name: deploy
    image: appleboy/drone-ssh
    settings:
      host:
        from_secret: DEPLOY_HOST
      username:
        from_secret: DEPLOY_USER
      password:
        from_secret: DEPLOY_PASSWORD
      port:
        from_secret: DEPLOY_PORT
      script:
        - docker service update --image registry.dev.juetan.cn/project/ssvserver:latest ssv_server
```
根目录下新建`Dockerfile`文件，添加如下内容：
```bash
FROM openjdk:8-jre-alpine
COPY ./target/example-2.0.0-RELEASE.jar /app.jar
ENTRYPOINT ["java","-jar","/app.jar"]
```
<a name="a9f94dcd"></a>
### 部署配置

1. 在`Portainer`页面中，依次选择`Stacks`- `Add Stack`，填写`name`为`ssv`，内容如下：
```yaml
version: '3.4'
   
services:
 server:
   image: registry.dev.juetan.cn/project/ssvserver
   networks:
     - public
   configs:
     - source: ssv-server-config
       target: /application.yml
   deploy:
     placement:
       constraints:
         - node.role==manager
     labels:
       - "traefik.port=8080"
       - "traefik.enable=true"
       - "traefik.docker.network=public"
       - "traefik.frontend.rule=Host:ssv.app.juetan.cn;PathPrefixStrip:/api"
       - "traefik.frontend.entryPoints=http, https"
       - "traefik.frontend.redirect.entryPoint=https"
 web:
   image: registry.dev.juetan.cn/project/ssvweb
   networks:
     - public
   deploy:
     placement:
       constraints:
         - node.role==manager
     labels:
       - "traefik.port=80"
       - "traefik.enable=true"
       - "traefik.docker.network=public"
       - "traefik.frontend.rule=Host:ssv.app.juetan.cn;"
       - "traefik.frontend.entryPoints=http, https"
       - "traefik.frontend.redirect.entryPoint=https"

configs:
 ssv-server-config1:
   external: true

networks:
 public:
   external: true
```

2. 在`Portainer`页面中，依次选择`Configs`- `Add Config`，填写`name`为`ssv-server-fonfig`，内容如下：
```
spring:
  datasource:
      url: jdbc:mysql://mysql.dev.cctomato.com:3306/example?useUnicode=true&characterEncoding=UTF-8&allowMultiQueries=true&serverTimezone=Asia/Shanghai
      username: root
      password: cctomato
logging:
  config: classpath:logback-prod.xml
mybatis:
   mapperLocations: classpath:/mapper/*.xml
```

3. 点击`Deploy the stack`按钮，等待服务部署完成，访问如下连接即可：
```yaml
http://ssv.app.juetan.cn
```
