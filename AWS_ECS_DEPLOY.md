# AWS ECS Deployment Guide — KJV Foundation Backend

## Architecture
```
Internet → ALB (Load Balancer) → ECS Fargate Tasks (auto-scale) → RDS/Neon PostgreSQL
                                                                 → MongoDB Atlas
                                                                 → Cloudflare R2
```

## Prerequisites
- AWS Account
- AWS CLI installed (`brew install awscli`)
- Docker installed
- Domain: `api.ektakolijatavvikasfoundation.com`

---

## Step 1: Install & Configure AWS CLI

```bash
# Install
brew install awscli

# Configure with your AWS Access Key
aws configure
# Enter: Access Key ID, Secret Access Key, Region (ap-south-1), Output (json)
```

---

## Step 2: Create ECR Repository (Docker Image Storage)

```bash
# Create repository
aws ecr create-repository --repository-name ekjvf-backend --region ap-south-1

# Login to ECR
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com
```

---

## Step 3: Build & Push Docker Image

```bash
cd backend

# Build image
docker build -t ekjvf-backend .

# Tag for ECR
docker tag ekjvf-backend:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ekjvf-backend:latest

# Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ekjvf-backend:latest
```

---

## Step 4: Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name ekjvf-production --region ap-south-1
```

Or via AWS Console:
1. ECS → Create Cluster
2. Name: `ekjvf-production`
3. Infrastructure: **AWS Fargate** (serverless, no EC2 management)

---

## Step 5: Create Task Definition

AWS Console → ECS → Task Definitions → Create new:

- **Family name:** `ekjvf-backend`
- **Launch type:** Fargate
- **OS:** Linux/X86_64
- **CPU:** 0.5 vCPU (scales up later)
- **Memory:** 1 GB
- **Container:**
  - Name: `ekjvf-backend`
  - Image: `YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ekjvf-backend:latest`
  - Port: 8080
  - Environment variables (add ALL):

```
NODE_ENV=production
PORT=8080
POSTGRES_URL=postgresql://ekjvf_admin:PASSWORD@your-rds.ap-south-1.rds.amazonaws.com:5432/ekjvf_production
MONGODB_URL=mongodb+srv://keshavgupta86036:FST2023k@cluster0.06aqope.mongodb.net/ngeo
JWT_ACCESS_SECRET=ekjvf_acc_Xk9mP2nQ7vB4wL8jR3dF6hY1cT5sA0gE
JWT_REFRESH_SECRET=ekjvf_ref_Zw4nM8qK2xV6bJ9pL1dH3yC7tF0sA5gR
RAZORPAY_KEY_ID=rzp_test_TIt7vDEhhh3eyf
RAZORPAY_KEY_SECRET=BjW5LTP2Lre5NjfB2lj6NCdb
RAZORPAY_PLAN_ID=plan_TJR8pyQeEa9xbC
REGISTRATION_FEE=351
MONTHLY_FEE=151
CLOUDFLARE_R2_ACCOUNT_ID=3e4fd4b723103e94feb32572e338c828
CLOUDFLARE_R2_ACCESS_KEY_ID=17295a60e8f9973a31f59d32da5d93ec
CLOUDFLARE_R2_SECRET_ACCESS_KEY=29876f431d8a5a08ac6173bac6cdb3e70476717ae536d6f4f9c1b94211822ecb
CLOUDFLARE_R2_BUCKET=ektakolijatav
CLOUDFLARE_R2_PUBLIC_URL=https://pub-de7ca42ae5644154bca0b4fc543f1e80.r2.dev
ADMIN_AUTH_DISABLED=false
DB_MEMORY_FALLBACK=false
GOOGLE_MAPS_API_KEY=AIzaSyBHWXqfUfDkSsyclTAfIxgq-iG-f87Sv88
```

---

## Step 6: Create Application Load Balancer (ALB)

AWS Console → EC2 → Load Balancers → Create:

1. Type: **Application Load Balancer**
2. Name: `ekjvf-alb`
3. Scheme: Internet-facing
4. Listener: HTTPS (port 443)
5. VPC: Default
6. Target Group:
   - Name: `ekjvf-tg`
   - Target type: IP
   - Port: 8080
   - Health check: `/api/health`
7. SSL Certificate: Request from ACM for `api.ektakolijatavvikasfoundation.com`

---

## Step 7: Create ECS Service

AWS Console → ECS → Cluster → Create Service:

- **Service name:** `ekjvf-backend-service`
- **Task definition:** `ekjvf-backend` (latest)
- **Desired tasks:** 1 (min)
- **Launch type:** Fargate
- **Networking:**
  - VPC: Default
  - Subnets: Select 2+ AZs
  - Security group: Allow port 8080 from ALB
- **Load balancer:** Select `ekjvf-alb`
- **Auto-scaling:**
  - Min: 1
  - Max: 10
  - Target tracking: CPU 70%

---

## Step 8: Configure Custom Domain

1. **Route 53** (or your DNS provider):
   - Create CNAME: `api.ektakolijatavvikasfoundation.com` → ALB DNS name

2. **ACM (SSL Certificate):**
   - Request certificate for `api.ektakolijatavvikasfoundation.com`
   - Validate via DNS (add CNAME record)
   - Attach to ALB listener

---

## Step 9: Auto-Scaling Policy

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/ekjvf-production/ekjvf-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 1 \
  --max-capacity 10

# Create scaling policy (scale at 70% CPU)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/ekjvf-production/ekjvf-backend-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

---

## Step 10: Deploy Updates (CI/CD)

Whenever you push code changes:

```bash
cd backend

# Build new image
docker build -t ekjvf-backend .

# Tag
docker tag ekjvf-backend:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ekjvf-backend:latest

# Push
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ekjvf-backend:latest

# Force new deployment (pulls latest image)
aws ecs update-service --cluster ekjvf-production --service ekjvf-backend-service --force-new-deployment
```

---

## Cost Estimate (Pay-as-you-go)

| Traffic | Tasks | Monthly Cost |
|---------|-------|-------------|
| <500 users | 1 task | ~$15 |
| 1K-5K users | 1-2 tasks | ~$30-50 |
| 5K-10K users | 2-4 tasks | ~$60-100 |
| 10K-50K users | 4-10 tasks | ~$150-350 |

*Plus: ALB ($20/month) + Data transfer*

---

## Quick Commands Reference

```bash
# Check service status
aws ecs describe-services --cluster ekjvf-production --services ekjvf-backend-service

# View logs
aws logs tail /ecs/ekjvf-backend --follow

# Scale manually (for testing)
aws ecs update-service --cluster ekjvf-production --service ekjvf-backend-service --desired-count 2

# Restart tasks
aws ecs update-service --cluster ekjvf-production --service ekjvf-backend-service --force-new-deployment
```

---

## Support
Email: Support@ektakolijatavvikasfoundation.com
