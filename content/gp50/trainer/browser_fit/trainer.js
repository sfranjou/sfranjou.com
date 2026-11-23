import {Trainer as TrialTrainer,pack,unpack,difference} from '../browser_train/trainer.js';
export {pack,unpack,difference};
export class Trainer extends TrialTrainer {
 exportModel(){return {...super.exportModel(),format:'compact-browser068-v1',note:'Full360update Peavey warm-start MFCC fit using saved teacher targets; Float64 training. New weights require runtime qualification.'};}
 record(row){const {parameters,...lean}=row;this.history.push(lean);}
}
