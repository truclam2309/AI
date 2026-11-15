import { Link } from 'react-router-dom';
import { ArrowRightIcon, UserRoundIcon } from 'lucide-react';
import { EmptyState } from './EmptyState';

export function ProfileRequired() {
  return (
    <div className="card">
      <EmptyState
        icon={<UserRoundIcon className="h-5 w-5" aria-hidden="true" />}
        title="Hoàn thiện hồ sơ sức khỏe"
        description="MyFit cần ngày sinh, chiều cao, cân nặng, giới tính tính BMR, mức vận động và mục tiêu để tính nhu cầu dinh dưỡng."
        action={
        <Link to="/profile" className="btn-primary">
            Tạo hồ sơ
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </Link>
        } />
      
    </div>);

}
