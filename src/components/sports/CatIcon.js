import {
  Baseball,
  Basketball,
  BoxingGlove,
  Cricket,
  FlagCheckered,
  Football,
  Golf,
  Hockey,
  SoccerBall,
  Target,
  TennisBall,
  Trophy,
  Volleyball,
} from '@phosphor-icons/react';

// One icon family for every sport (no emoji standing in for icons).
const CAT_ICONS = {
  'American Football': Football, 'Australian Football': Football, Rugby: Football, Basketball, Soccer: SoccerBall,
  Baseball, Hockey, 'Combat Sports': BoxingGlove, Tennis: TennisBall, Golf, Racing: FlagCheckered,
  Cricket, Volleyball, Darts: Target,
};

export function CatIcon({ category, size = 16 }) {
  const Icon = CAT_ICONS[category] || Trophy;
  return <Icon size={size} weight="bold" aria-hidden="true" className="st-cat-icon" />;
}
