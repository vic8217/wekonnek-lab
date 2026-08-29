import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MerchantSubscriptionBillingService } from './merchant-subscription-billing.service';
import { subscriptionBillingSchedule } from './philippine-billing-day';

@Injectable()
export class MerchantSubscriptionBillingScheduler implements OnModuleInit {
  private readonly logger = new Logger(
    MerchantSubscriptionBillingScheduler.name,
  );

  constructor(
    private readonly billing: MerchantSubscriptionBillingService,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const schedule = subscriptionBillingSchedule(this.config);
    this.register(
      'subscription-daily-billing',
      schedule.cron,
      schedule.timeZone,
    );
    if (schedule.catchupCron && schedule.catchupCron !== schedule.cron) {
      this.register(
        'subscription-daily-billing-catchup',
        schedule.catchupCron,
        schedule.timeZone,
      );
    }
  }

  async runScheduledBilling() {
    return this.billing.runDailyBilling();
  }

  private register(name: string, cron: string, timeZone: string) {
    const job = CronJob.from({
      cronTime: cron,
      onTick: () => {
        void this.runScheduledBilling();
      },
      start: false,
      timeZone,
    });
    this.scheduler.addCronJob(name, job);
    job.start();
    this.logger.log(
      `subscription_billing_schedule name=${name} cron=${cron} timeZone=${timeZone}`,
    );
  }
}
